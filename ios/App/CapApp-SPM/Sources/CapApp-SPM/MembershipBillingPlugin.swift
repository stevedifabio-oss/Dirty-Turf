import Capacitor
import Foundation
import StoreKit
import UIKit

/// StoreKit supplies purchase proof; only the Academy server may grant access.
@objc(MembershipBillingPlugin)
public final class MembershipBillingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MembershipBillingPlugin"
    public let jsName = "MembershipBilling"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise),
    ]

    private let store = AcademyMembershipStore()
    private var updatesTask: Task<Void, Never>?
    @MainActor private var managementPresented = false

    public override func load() {
        // Start at launch so delayed approvals and renewals are never finished
        // before their signed proof has reached the authenticated server.
        updatesTask = Task { [weak self] in
            for await result in StoreKit.Transaction.updates {
                guard !Task.isCancelled else { return }
                guard let self else { return }
                guard let proof = await self.store.remember(result) else { continue }
                await MainActor.run {
                    self.notifyListeners("billingPurchaseUpdated", data: [
                        "status": "purchased", "purchases": [proof],
                    ], retainUntilConsumed: true)
                }
            }
        }
    }

    deinit { updatesTask?.cancel() }

    @objc public func getProducts(_ call: CAPPluginCall) {
        Task { [weak self] in
            guard let self else { return }
            do {
                let products = try await self.store.getProducts()
                await MainActor.run {
                    call.resolve([
                        "available": AppStore.canMakePayments && !products.isEmpty,
                        "products": products,
                    ])
                }
            } catch {
                await MainActor.run { call.reject("App Store membership options could not load. Please try again.") }
            }
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        guard let productID = call.getString("productId"),
              AcademyMembershipStore.productIDs.contains(productID),
              let rawToken = call.getString("accountToken"),
              let accountToken = UUID(uuidString: rawToken),
              accountToken != UUID(uuid: (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)) else {
            call.reject("A valid membership and signed-in account are required.")
            return
        }
        Task { [weak self] in
            guard let self else { return }
            do {
                let response = try await self.store.purchase(productID, accountToken: accountToken)
                await MainActor.run { call.resolve(response) }
            } catch let error as MembershipStoreError {
                await MainActor.run { call.reject(error.message) }
            } catch {
                await MainActor.run { call.reject("The App Store purchase could not complete. Check your purchases before trying again.") }
            }
        }
    }

    @objc public func restorePurchases(_ call: CAPPluginCall) {
        // A user-triggered Restore may show Apple's sign-in prompt. The app can
        // use sync:false for a quiet foreground entitlement refresh.
        let synchronize = call.getBool("sync") ?? true
        Task { [weak self] in
            guard let self else { return }
            do {
                let purchases = try await self.store.restore(synchronize: synchronize)
                await MainActor.run { call.resolve(["purchases": purchases]) }
            } catch let error as MembershipStoreError {
                await MainActor.run { call.reject(error.message) }
            } catch {
                await MainActor.run { call.reject("App Store purchases could not be restored. Please try again.") }
            }
        }
    }

    @objc public func finishTransaction(_ call: CAPPluginCall) {
        guard let rawID = call.getString("transactionId"),
              let transactionID = UInt64(rawID), transactionID > 0,
              String(transactionID) == rawID else {
            call.reject("A valid App Store transaction is required.")
            return
        }
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.store.finish(transactionID)
                await MainActor.run { call.resolve(["finished": true]) }
            } catch {
                await MainActor.run { call.reject("This transaction could not be finished. Restore purchases and try again.") }
            }
        }
    }

    @objc public func manageSubscriptions(_ call: CAPPluginCall) {
        if let productID = call.getString("productId"), !AcademyMembershipStore.productIDs.contains(productID) {
            call.reject("A supported membership is required.")
            return
        }
        #if targetEnvironment(macCatalyst)
        call.reject("Manage these subscriptions from your App Store account on this device.")
        #else
        Task { @MainActor [weak self] in
            guard !ProcessInfo.processInfo.isiOSAppOnMac else {
                call.reject("Manage these subscriptions from your App Store account on this device.")
                return
            }
            guard let self,
                  let scene = self.bridge?.viewController?.viewIfLoaded?.window?.windowScene,
                  scene.activationState == .foregroundActive else {
                call.reject("Open the app before managing your App Store subscriptions.")
                return
            }
            guard !self.managementPresented else {
                call.reject("App Store subscription management is already open.")
                return
            }
            self.managementPresented = true
            defer { self.managementPresented = false }
            do {
                // Apple presents all subscriptions for this app. Do not use an
                // external checkout link or treat dismissal as cancellation.
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve(["opened": true])
            } catch {
                call.reject("App Store subscription management could not open. Please try again.")
            }
        }
        #endif
    }
}

private enum MembershipStoreError: Error {
    case busy, unavailable, unverified, accountMismatch

    var message: String {
        switch self {
        case .busy: return "Another App Store operation is already in progress."
        case .unavailable: return "This membership is not available for purchase from the App Store."
        case .unverified: return "The App Store purchase could not be verified. No access has been added."
        case .accountMismatch: return "This App Store purchase belongs to a different Academy login. Sign in to the original account or contact support."
        }
    }
}

private actor AcademyMembershipStore {
    static let productIDs: Set<String> = [
        "dirty_turf_community_monthly",
        "dirty_turf_scanner_monthly",
        "dirty_turf_academy_monthly",
    ]
    private var products: [String: Product] = [:]
    private var transactions: [UInt64: StoreKit.Transaction] = [:]
    private var finishedTransactionIDs: Set<UInt64> = []
    private var finishedTransactionOrder: [UInt64] = []
    private var operationInProgress = false

    func getProducts() async throws -> [JSObject] {
        let loaded = try await Product.products(for: Self.productIDs)
        products = Dictionary(uniqueKeysWithValues: loaded.filter { product in
            guard product.type == .autoRenewable,
                  let period = product.subscription?.subscriptionPeriod else { return false }
            return Self.productIDs.contains(product.id) && period.unit == .month && period.value == 1
        }.map { ($0.id, $0) })
        return products.values.sorted { $0.id < $1.id }.map { product in
            let micros = NSDecimalNumber(decimal: product.price * Decimal(1_000_000))
            return [
                "id": product.id,
                "displayName": product.displayName,
                "displayPrice": product.displayPrice,
                "priceAmountMicros": micros.int64Value,
                "currencyCode": product.priceFormatStyle.currencyCode,
            ]
        }
    }

    func purchase(_ productID: String, accountToken: UUID) async throws -> JSObject {
        guard !operationInProgress else { throw MembershipStoreError.busy }
        guard AppStore.canMakePayments, Self.productIDs.contains(productID) else {
            throw MembershipStoreError.unavailable
        }
        operationInProgress = true
        defer { operationInProgress = false }
        if products[productID] == nil { _ = try await getProducts() }
        guard let product = products[productID] else { throw MembershipStoreError.unavailable }
        let result = try await product.purchase(options: [.appAccountToken(accountToken)])
        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification,
                  transaction.productID == productID else { throw MembershipStoreError.unverified }
            guard transaction.appAccountToken == accountToken else { throw MembershipStoreError.accountMismatch }
            guard let proof = remember(verification) else { throw MembershipStoreError.unverified }
            return ["status": "purchased", "purchases": [proof]]
        case .pending:
            return ["status": "pending", "purchases": []]
        case .userCancelled:
            return ["status": "cancelled", "purchases": []]
        @unknown default:
            throw MembershipStoreError.unavailable
        }
    }

    func restore(synchronize: Bool) async throws -> [JSObject] {
        guard !operationInProgress else { throw MembershipStoreError.busy }
        operationInProgress = true
        defer { operationInProgress = false }
        if synchronize { try await AppStore.sync() }
        var purchases: [UInt64: JSObject] = [:]
        for await verification in StoreKit.Transaction.currentEntitlements {
            guard case .verified(let transaction) = verification,
                  let proof = remember(verification) else { continue }
            purchases[transaction.id] = proof
        }
        // A failed server connection must not lose a paid but unfinished purchase.
        for await verification in StoreKit.Transaction.unfinished {
            guard case .verified(let transaction) = verification,
                  let proof = remember(verification) else { continue }
            purchases[transaction.id] = proof
        }
        return purchases.keys.sorted().compactMap { purchases[$0] }
    }

    func remember(_ verification: VerificationResult<StoreKit.Transaction>) -> JSObject? {
        guard case .verified(let transaction) = verification,
              Self.productIDs.contains(transaction.productID), transaction.productType == .autoRenewable else { return nil }
        transactions[transaction.id] = transaction
        // Expired/revoked updates still reach the server so it can reconcile access.
        // Do not log or persist the signed proof in browser storage.
        return [
            "provider": "apple",
            "productId": transaction.productID,
            "transactionId": String(transaction.id),
            "signedTransactionInfo": verification.jwsRepresentation,
        ]
    }

    func finish(_ transactionID: UInt64) async throws {
        if finishedTransactionIDs.contains(transactionID) { return }
        if let transaction = transactions[transactionID] {
            await finishVerifiedTransaction(transaction)
            return
        }
        for await verification in StoreKit.Transaction.unfinished {
            guard case .verified(let transaction) = verification,
                  transaction.id == transactionID, Self.productIDs.contains(transaction.productID),
                  transaction.productType == .autoRenewable else { continue }
            await finishVerifiedTransaction(transaction)
            return
        }
        // A completed proof can be retried after a WebView reload, when this
        // plugin's in-memory set is empty. Accept only an exact, StoreKit-verified
        // current entitlement, never an arbitrary client-supplied identifier.
        for await verification in StoreKit.Transaction.currentEntitlements {
            guard case .verified(let transaction) = verification,
                  transaction.id == transactionID, Self.productIDs.contains(transaction.productID),
                  transaction.productType == .autoRenewable else { continue }
            await finishVerifiedTransaction(transaction)
            return
        }
        throw MembershipStoreError.unavailable
    }

    private func finishVerifiedTransaction(_ transaction: StoreKit.Transaction) async {
        await transaction.finish()
        transactions.removeValue(forKey: transaction.id)
        if finishedTransactionIDs.insert(transaction.id).inserted {
            finishedTransactionOrder.append(transaction.id)
            if finishedTransactionOrder.count > 256 {
                finishedTransactionIDs.remove(finishedTransactionOrder.removeFirst())
            }
        }
    }
}

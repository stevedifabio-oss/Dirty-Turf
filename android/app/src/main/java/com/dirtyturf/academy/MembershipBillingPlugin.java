package com.dirtyturf.academy;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Launches Google Play purchase UI and returns proof for server verification. Never grants access. */
@CapacitorPlugin(name = "MembershipBilling")
public class MembershipBillingPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<ConnectionRequest> connectionRequests = new ArrayList<>();
    private BillingClient billing;
    private boolean connecting;
    private boolean connectedOnce;
    private boolean destroyed;
    private int connectionGeneration;
    private PluginCall purchaseCall;
    private String requestedProduct;
    private String requestedAccount;
    private Runnable connectionTimeout;

    private static final class ConnectionRequest {
        final PluginCall call;
        final Runnable action;
        ConnectionRequest(PluginCall call, Runnable action) { this.call = call; this.action = action; }
    }

    @Override
    public void load() {
        main.post(this::createBillingClient);
    }

    private void createBillingClient() {
        if (destroyed) return;
        connectionGeneration++;
        billing = BillingClient.newBuilder(getContext())
            .setListener((result, purchases) -> main.post(() -> handlePurchaseUpdate(result, purchases)))
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    @PluginMethod
    public void getProducts(PluginCall call) {
        main.post(() -> withBilling(call, () -> queryProducts(call, new ArrayList<>(MembershipBillingPolicy.PRODUCT_IDS), products -> {
            JSArray output = new JSArray();
            for (ProductDetails product : products) {
                ProductDetails.SubscriptionOfferDetails offer = monthlyOffer(product);
                if (offer == null) continue;
                ProductDetails.PricingPhase price = offer.getPricingPhases().getPricingPhaseList().get(0);
                JSObject item = new JSObject();
                item.put("id", product.getProductId());
                item.put("displayName", product.getName());
                item.put("displayPrice", price.getFormattedPrice());
                item.put("priceAmountMicros", price.getPriceAmountMicros());
                item.put("currencyCode", price.getPriceCurrencyCode());
                output.put(item);
            }
            JSObject response = new JSObject();
            response.put("available", output.length() > 0);
            response.put("products", output);
            call.resolve(response);
        })));
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        final String productId = call.getString("productId");
        if (!MembershipBillingPolicy.PRODUCT_IDS.contains(productId)) {
            call.reject("This membership is not available.", "INVALID_PRODUCT");
            return;
        }
        final String accountId;
        try { accountId = MembershipBillingPolicy.accountIdentifier(call.getString("accountToken")); }
        catch (IllegalArgumentException exception) { call.reject(exception.getMessage(), "SIGN_IN_REQUIRED"); return; }
        main.post(() -> {
            if (purchaseCall != null) {
                call.reject("Finish the current purchase before starting another.", "PURCHASE_IN_PROGRESS");
                return;
            }
            purchaseCall = call;
            requestedProduct = productId;
            requestedAccount = accountId;
            withBilling(call, () -> queryOwned(call, owned -> {
                if (purchaseCall != call) return;
                for (Purchase purchase : owned) {
                    if (purchase.getProducts().contains(productId) && isRestorable(purchase)) {
                        completePurchase(Collections.singletonList(purchase));
                        return;
                    }
                }
                // Refresh ProductDetails immediately before purchase; do not cache offer tokens.
                queryProducts(call, Collections.singletonList(productId), products -> {
                    if (purchaseCall != call) return;
                    ProductDetails product = products.stream().filter(value -> productId.equals(value.getProductId())).findFirst().orElse(null);
                    ProductDetails.SubscriptionOfferDetails offer = product == null ? null : monthlyOffer(product);
                    if (offer == null) { reject(call, "This membership is not available from Google Play yet.", "PRODUCT_UNAVAILABLE"); return; }
                    if (getActivity() == null || getActivity().isFinishing()) {
                        reject(call, "Reopen the app before purchasing.", "ACTIVITY_UNAVAILABLE");
                        return;
                    }
                    BillingFlowParams.ProductDetailsParams item = BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(product).setOfferToken(offer.getOfferToken()).build();
                    BillingFlowParams params = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(Collections.singletonList(item))
                        .setObfuscatedAccountId(accountId).build();
                    BillingResult launch = billing.launchBillingFlow(getActivity(), params);
                    if (launch.getResponseCode() != BillingClient.BillingResponseCode.OK) handlePurchaseUpdate(launch, null);
                });
            }));
        });
    }

    @PluginMethod
    public void manageSubscriptions(PluginCall call) {
        final String productId = call.getString("productId");
        final String destination;
        try {
            if (call.getData().has("productId") && productId == null) throw new IllegalArgumentException("This membership is not supported.");
            destination = MembershipBillingPolicy.subscriptionManagementUrl(productId);
        } catch (IllegalArgumentException exception) {
            call.reject(exception.getMessage(), "INVALID_PRODUCT");
            return;
        }
        main.post(() -> {
            if (destroyed || getActivity() == null || getActivity().isFinishing() || getActivity().isDestroyed()) {
                call.reject("Reopen the app before managing subscriptions.", "ACTIVITY_UNAVAILABLE");
                return;
            }
            if (purchaseCall != null) {
                call.reject("Finish or cancel the current purchase before managing subscriptions.", "PURCHASE_IN_PROGRESS");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(destination)).addCategory(Intent.CATEGORY_BROWSABLE);
            try {
                try { getActivity().startActivity(new Intent(intent).setPackage("com.android.vending")); }
                catch (ActivityNotFoundException exception) { getActivity().startActivity(intent); }
                JSObject result = new JSObject();
                result.put("opened", true);
                call.resolve(result);
            } catch (ActivityNotFoundException | SecurityException exception) {
                call.reject("Google Play subscription management could not open on this device.", "MANAGEMENT_UNAVAILABLE");
            }
        });
    }

    @PluginMethod
    public void restorePurchases(PluginCall call) {
        main.post(() -> withBilling(call, () -> queryOwned(call, purchases -> {
            JSObject result = new JSObject();
            result.put("purchases", purchaseProofs(purchases));
            call.resolve(result);
        })));
    }

    private interface ProductResult { void accept(List<ProductDetails> products); }
    private interface PurchaseResult { void accept(List<Purchase> purchases); }

    private void queryProducts(PluginCall call, List<String> productIds, ProductResult result) {
        List<QueryProductDetailsParams.Product> items = new ArrayList<>();
        for (String productId : productIds) items.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(productId).setProductType(BillingClient.ProductType.SUBS).build());
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder().setProductList(items).build();
        billing.queryProductDetailsAsync(params, (response, details) -> main.post(() -> {
            if (destroyed) return;
            if (response.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                reject(call, "Google Play could not load memberships. Please try again.", "PRODUCTS_UNAVAILABLE");
                return;
            }
            result.accept(details.getProductDetailsList());
        }));
    }

    private void queryOwned(PluginCall call, PurchaseResult result) {
        billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
            (response, purchases) -> main.post(() -> {
                if (destroyed) return;
                if (response.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    if (call != null) reject(call, "Google Play could not check existing purchases. Please try again.", "RESTORE_UNAVAILABLE");
                    return;
                }
                result.accept(purchases);
            }));
    }

    private void withBilling(PluginCall call, Runnable action) {
        if (destroyed) { reject(call, "Reopen the app before using Google Play billing.", "APP_CLOSED"); return; }
        if (billing == null) createBillingClient();
        // After the first setup, the library reconnects automatically for API calls.
        if (billing.isReady() || connectedOnce) { action.run(); return; }
        connectionRequests.add(new ConnectionRequest(call, action));
        if (connecting) return;
        connecting = true;
        final int generation = connectionGeneration;
        connectionTimeout = () -> {
            if (destroyed || generation != connectionGeneration || !connecting) return;
            connecting = false;
            rejectConnections();
            billing.endConnection();
            billing = null;
            connectionGeneration++;
        };
        main.postDelayed(connectionTimeout, 20000);
        billing.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) {
                main.post(() -> {
                    if (destroyed || generation != connectionGeneration) return;
                    connecting = false;
                    if (connectionTimeout != null) main.removeCallbacks(connectionTimeout);
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { rejectConnections(); return; }
                    connectedOnce = true;
                    List<ConnectionRequest> waiting = new ArrayList<>(connectionRequests);
                    connectionRequests.clear();
                    for (ConnectionRequest request : waiting) request.action.run();
                });
            }
            @Override public void onBillingServiceDisconnected() {
                // enableAutoServiceReconnection handles the next API call. Never start parallel connections here.
            }
        });
    }

    private void rejectConnections() {
        List<ConnectionRequest> waiting = new ArrayList<>(connectionRequests);
        connectionRequests.clear();
        for (ConnectionRequest request : waiting) {
            if (request.call != null) reject(request.call, "Google Play billing is unavailable. Check your connection and try again.", "BILLING_UNAVAILABLE");
        }
    }

    private ProductDetails.SubscriptionOfferDetails monthlyOffer(ProductDetails product) {
        if (!MembershipBillingPolicy.PRODUCT_IDS.contains(product.getProductId()) || product.getSubscriptionOfferDetails() == null) return null;
        for (ProductDetails.SubscriptionOfferDetails offer : product.getSubscriptionOfferDetails()) {
            List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
            if (phases.size() != 1) continue;
            ProductDetails.PricingPhase phase = phases.get(0);
            if (MembershipBillingPolicy.isPaidMonthlyBasePlan(offer.getBasePlanId(), offer.getOfferId(), phases.size(),
                phase.getBillingPeriod(), phase.getRecurrenceMode() == ProductDetails.RecurrenceMode.INFINITE_RECURRING,
                phase.getPriceAmountMicros())) return offer;
        }
        return null;
    }

    private boolean isRestorable(Purchase purchase) {
        return purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED || purchase.getPurchaseState() == Purchase.PurchaseState.PENDING;
    }

    private JSArray purchaseProofs(List<Purchase> purchases) {
        JSArray proofs = new JSArray();
        if (purchases == null) return proofs;
        for (Purchase purchase : purchases) {
            if (!isRestorable(purchase)) continue;
            for (String productId : purchase.getProducts()) {
                if (!MembershipBillingPolicy.PRODUCT_IDS.contains(productId)) continue;
                JSObject proof = new JSObject();
                proof.put("provider", "google");
                proof.put("productId", productId);
                proof.put("purchaseToken", purchase.getPurchaseToken());
                proof.put("transactionId", purchase.getOrderId());
                proof.put("purchaseState", purchase.getPurchaseState() == Purchase.PurchaseState.PENDING ? "pending" : "purchased");
                proofs.put(proof);
            }
        }
        return proofs;
    }

    private void handlePurchaseUpdate(BillingResult result, List<Purchase> purchases) {
        if (destroyed) return;
        int response = result.getResponseCode();
        if (response == BillingClient.BillingResponseCode.OK) {
            if (purchaseCall != null && (purchases == null || purchases.isEmpty())) {
                reject(purchaseCall, "Google Play did not return a purchase. Restore purchases before trying again.", "PURCHASE_RESULT_UNAVAILABLE");
                return;
            }
            JSArray proofs = purchaseProofs(purchases);
            if (proofs.length() > 0) {
                JSObject event = new JSObject();
                event.put("status", hasPurchased(purchases) ? "purchased" : "pending");
                event.put("purchases", proofs);
                notifyListeners("billingPurchaseUpdated", event);
            }
            if (purchaseCall != null && purchases != null) {
                List<Purchase> matching = new ArrayList<>();
                for (Purchase purchase : purchases) if (purchase.getProducts().contains(requestedProduct) && isRestorable(purchase)) matching.add(purchase);
                if (!matching.isEmpty()) completePurchase(matching);
            }
        } else if (purchaseCall != null && response == BillingClient.BillingResponseCode.USER_CANCELED) {
            PluginCall call = purchaseCall;
            clearPurchase();
            JSObject cancelled = new JSObject();
            cancelled.put("status", "cancelled");
            cancelled.put("purchases", new JSArray());
            call.resolve(cancelled);
        } else if (purchaseCall != null && response == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            PluginCall call = purchaseCall;
            queryOwned(call, owned -> { if (purchaseCall == call) completePurchase(owned); });
        } else if (purchaseCall != null) {
            reject(purchaseCall, "The purchase could not be completed. Check Google Play and try again.", "PURCHASE_FAILED");
        }
    }

    private boolean hasPurchased(List<Purchase> purchases) {
        if (purchases == null) return false;
        for (Purchase purchase : purchases) if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) return true;
        return false;
    }

    private void completePurchase(List<Purchase> purchases) {
        if (purchaseCall == null) return;
        List<Purchase> matching = new ArrayList<>();
        for (Purchase purchase : purchases) {
            if (!purchase.getProducts().contains(requestedProduct) || !isRestorable(purchase)) continue;
            String owner = purchase.getAccountIdentifiers() == null ? null : purchase.getAccountIdentifiers().getObfuscatedAccountId();
            if (owner != null && !owner.equals(requestedAccount)) {
                reject(purchaseCall, "This Google Play purchase belongs to a different member login. Use its original login to restore it.", "ACCOUNT_MISMATCH");
                return;
            }
            matching.add(purchase);
        }
        if (matching.isEmpty()) { reject(purchaseCall, "Restore your existing purchase before purchasing again.", "ALREADY_OWNED"); return; }
        PluginCall call = purchaseCall;
        clearPurchase();
        JSObject result = new JSObject();
        result.put("status", hasPurchased(matching) ? "purchased" : "pending");
        result.put("purchases", purchaseProofs(matching));
        // Acknowledgement and access are handled by the server only after validation with Google.
        call.resolve(result);
    }

    private void reject(PluginCall call, String message, String code) {
        if (call == purchaseCall) clearPurchase();
        call.reject(message, code);
    }

    private void clearPurchase() {
        purchaseCall = null;
        requestedProduct = null;
        requestedAccount = null;
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        main.post(() -> {
            if (destroyed) return;
            withBilling(null, () -> queryOwned(null, purchases -> {
                if (purchaseProofs(purchases).length() > 0) handlePurchaseUpdate(
                    BillingResult.newBuilder().setResponseCode(BillingClient.BillingResponseCode.OK).build(), purchases
                );
            }));
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true;
            connectionGeneration++;
            if (connectionTimeout != null) main.removeCallbacks(connectionTimeout);
            rejectConnections();
            if (purchaseCall != null) reject(purchaseCall, "Reopen the app and restore purchases to check this transaction.", "APP_CLOSED");
            if (billing != null) billing.endConnection();
            billing = null;
        });
        super.handleOnDestroy();
    }
}

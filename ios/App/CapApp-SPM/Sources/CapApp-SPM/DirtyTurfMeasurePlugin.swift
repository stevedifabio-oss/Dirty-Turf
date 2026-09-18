import ARKit
import Capacitor
import SceneKit
import UIKit

@objc(DirtyTurfMeasurePlugin)
public final class DirtyTurfMeasurePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DirtyTurfMeasurePlugin"
    public let jsName = "DirtyTurfMeasure"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startAreaMeasurement", returnType: CAPPluginReturnPromise),
    ]

    @objc public func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": ARWorldTrackingConfiguration.isSupported])
    }

    @objc public func startAreaMeasurement(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.reject("Live measurement is not supported on this iPhone or iPad.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.reject("The live measurement screen is unavailable.")
                return
            }

            let controller = LiveMeasureViewController { result in
                presenter.dismiss(animated: true) {
                    guard let result else {
                        call.reject("Measurement cancelled.")
                        return
                    }
                    call.resolve(result.asJavaScriptObject)
                }
            }
            controller.modalPresentationStyle = .fullScreen
            presenter.present(controller, animated: true)
        }
    }
}

private struct NativeMeasurementResult {
    let areaSquareFeet: Double
    let perimeterFeet: Double
    let points: [SIMD3<Float>]
    let capturedAt: String

    var asJavaScriptObject: JSObject {
        [
            "areaSquareFeet": areaSquareFeet,
            "perimeterFeet": perimeterFeet,
            "points": points.map { ["x": $0.x, "y": $0.y, "z": $0.z] },
            "capturedAt": capturedAt,
        ]
    }
}

private final class LiveMeasureViewController: UIViewController, ARSCNViewDelegate {
    private let completion: (NativeMeasurementResult?) -> Void
    private let sceneView = ARSCNView(frame: .zero)
    private let statusLabel = UILabel()
    private let addButton = UIButton(type: .system)
    private let undoButton = UIButton(type: .system)
    private let finishButton = UIButton(type: .system)
    private var points: [SIMD3<Float>] = []
    private var markerNodes: [SCNNode] = []
    private var lineNodes: [SCNNode] = []

    init(completion: @escaping (NativeMeasurementResult?) -> Void) {
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.02, green: 0.12, blue: 0.06, alpha: 1)
        configureScene()
        configureOverlay()
        updateReadout(message: "Move slowly, aim the reticle at the first turf corner, then add a point.")
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .automatic
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
            configuration.sceneReconstruction = .meshWithClassification
        }
        sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
    }

    private func configureScene() {
        sceneView.translatesAutoresizingMaskIntoConstraints = false
        sceneView.delegate = self
        sceneView.automaticallyUpdatesLighting = true
        sceneView.scene = SCNScene()
        view.addSubview(sceneView)
        NSLayoutConstraint.activate([
            sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            sceneView.topAnchor.constraint(equalTo: view.topAnchor),
            sceneView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    private func configureOverlay() {
        let header = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        header.translatesAutoresizingMaskIntoConstraints = false
        header.layer.cornerRadius = 8
        header.clipsToBounds = true

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "LIVE TURF MEASUREMENT"
        title.textColor = UIColor(red: 0.47, green: 0.76, blue: 0.18, alpha: 1)
        title.font = .systemFont(ofSize: 13, weight: .black)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        statusLabel.numberOfLines = 0

        header.contentView.addSubview(title)
        header.contentView.addSubview(statusLabel)
        view.addSubview(header)

        let reticle = UIView()
        reticle.translatesAutoresizingMaskIntoConstraints = false
        reticle.layer.cornerRadius = 27
        reticle.layer.borderColor = UIColor.white.cgColor
        reticle.layer.borderWidth = 2
        reticle.backgroundColor = UIColor.clear
        view.addSubview(reticle)

        let horizontal = UIView()
        horizontal.translatesAutoresizingMaskIntoConstraints = false
        horizontal.backgroundColor = .white
        let vertical = UIView()
        vertical.translatesAutoresizingMaskIntoConstraints = false
        vertical.backgroundColor = .white
        reticle.addSubview(horizontal)
        reticle.addSubview(vertical)

        let controls = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        controls.translatesAutoresizingMaskIntoConstraints = false
        controls.layer.cornerRadius = 8
        controls.clipsToBounds = true
        view.addSubview(controls)

        addButton.setTitle("Add point", for: .normal)
        addButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .bold)
        addButton.backgroundColor = UIColor(red: 0.47, green: 0.76, blue: 0.18, alpha: 1)
        addButton.setTitleColor(UIColor(red: 0.01, green: 0.18, blue: 0.07, alpha: 1), for: .normal)
        addButton.layer.cornerRadius = 8
        addButton.heightAnchor.constraint(equalToConstant: 52).isActive = true
        addButton.addTarget(self, action: #selector(addPoint), for: .touchUpInside)

        let cancelButton = secondaryButton(title: "Cancel", action: #selector(cancel))
        undoButton.setTitle("Undo", for: .normal)
        styleSecondaryButton(undoButton)
        undoButton.addTarget(self, action: #selector(undoPoint), for: .touchUpInside)
        finishButton.setTitle("Finish", for: .normal)
        styleSecondaryButton(finishButton)
        finishButton.addTarget(self, action: #selector(finishMeasurement), for: .touchUpInside)

        let secondaryRow = UIStackView(arrangedSubviews: [cancelButton, undoButton, finishButton])
        secondaryRow.axis = .horizontal
        secondaryRow.spacing = 8
        secondaryRow.distribution = .fillEqually

        let controlStack = UIStackView(arrangedSubviews: [addButton, secondaryRow])
        controlStack.translatesAutoresizingMaskIntoConstraints = false
        controlStack.axis = .vertical
        controlStack.spacing = 8
        controls.contentView.addSubview(controlStack)

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 14),
            header.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -14),
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 10),
            title.leadingAnchor.constraint(equalTo: header.contentView.leadingAnchor, constant: 14),
            title.trailingAnchor.constraint(equalTo: header.contentView.trailingAnchor, constant: -14),
            title.topAnchor.constraint(equalTo: header.contentView.topAnchor, constant: 12),
            statusLabel.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            statusLabel.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 5),
            statusLabel.bottomAnchor.constraint(equalTo: header.contentView.bottomAnchor, constant: -12),
            reticle.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            reticle.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            reticle.widthAnchor.constraint(equalToConstant: 54),
            reticle.heightAnchor.constraint(equalToConstant: 54),
            horizontal.centerXAnchor.constraint(equalTo: reticle.centerXAnchor),
            horizontal.centerYAnchor.constraint(equalTo: reticle.centerYAnchor),
            horizontal.widthAnchor.constraint(equalToConstant: 70),
            horizontal.heightAnchor.constraint(equalToConstant: 2),
            vertical.centerXAnchor.constraint(equalTo: reticle.centerXAnchor),
            vertical.centerYAnchor.constraint(equalTo: reticle.centerYAnchor),
            vertical.widthAnchor.constraint(equalToConstant: 2),
            vertical.heightAnchor.constraint(equalToConstant: 70),
            controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 14),
            controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -14),
            controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10),
            controlStack.leadingAnchor.constraint(equalTo: controls.contentView.leadingAnchor, constant: 10),
            controlStack.trailingAnchor.constraint(equalTo: controls.contentView.trailingAnchor, constant: -10),
            controlStack.topAnchor.constraint(equalTo: controls.contentView.topAnchor, constant: 10),
            controlStack.bottomAnchor.constraint(equalTo: controls.contentView.bottomAnchor, constant: -10),
        ])
        updateButtons()
    }

    private func secondaryButton(title: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        styleSecondaryButton(button)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func styleSecondaryButton(_ button: UIButton) {
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        button.backgroundColor = UIColor.white.withAlphaComponent(0.14)
        button.setTitleColor(.white, for: .normal)
        button.layer.cornerRadius = 8
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    @objc private func addPoint() {
        let center = CGPoint(x: sceneView.bounds.midX, y: sceneView.bounds.midY)
        let result = raycast(from: center, allowing: .existingPlaneGeometry)
            ?? raycast(from: center, allowing: .estimatedPlane)

        guard let result else {
            updateReadout(message: "No turf surface found at the reticle. Move slowly and aim at a textured area.")
            return
        }

        let transform = result.worldTransform
        let point = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
        points.append(point)
        addMarker(at: point)
        rebuildLines()
        updateReadout()
        updateButtons()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    private func raycast(from point: CGPoint, allowing target: ARRaycastQuery.Target) -> ARRaycastResult? {
        guard let query = sceneView.raycastQuery(from: point, allowing: target, alignment: .horizontal) else {
            return nil
        }
        return sceneView.session.raycast(query).first
    }

    @objc private func undoPoint() {
        guard !points.isEmpty else { return }
        points.removeLast()
        markerNodes.removeLast().removeFromParentNode()
        rebuildLines()
        updateReadout()
        updateButtons()
    }

    @objc private func finishMeasurement() {
        guard points.count >= 3 else {
            updateReadout(message: "Add at least three boundary points before finishing.")
            return
        }
        let result = NativeMeasurementResult(
            areaSquareFeet: polygonAreaSquareMeters(points) * 10.763_910_416_7,
            perimeterFeet: polygonPerimeterMeters(points) * 3.280_839_895,
            points: points,
            capturedAt: ISO8601DateFormatter().string(from: Date())
        )
        completion(result)
    }

    @objc private func cancel() {
        completion(nil)
    }

    private func addMarker(at point: SIMD3<Float>) {
        let sphere = SCNSphere(radius: 0.025)
        sphere.firstMaterial?.diffuse.contents = UIColor(red: 0.47, green: 0.76, blue: 0.18, alpha: 1)
        sphere.firstMaterial?.lightingModel = .constant
        let node = SCNNode(geometry: sphere)
        node.simdPosition = point
        sceneView.scene.rootNode.addChildNode(node)
        markerNodes.append(node)
    }

    private func rebuildLines() {
        lineNodes.forEach { $0.removeFromParentNode() }
        lineNodes.removeAll()
        guard points.count >= 2 else { return }

        for index in 0..<(points.count - 1) {
            addLine(from: points[index], to: points[index + 1])
        }
        if points.count >= 3, let first = points.first, let last = points.last {
            addLine(from: last, to: first)
        }
    }

    private func addLine(from start: SIMD3<Float>, to end: SIMD3<Float>) {
        let delta = end - start
        let length = simd_length(delta)
        guard length > 0.001 else { return }
        let cylinder = SCNCylinder(radius: 0.007, height: CGFloat(length))
        cylinder.firstMaterial?.diffuse.contents = UIColor(red: 0.47, green: 0.76, blue: 0.18, alpha: 1)
        cylinder.firstMaterial?.lightingModel = .constant
        let node = SCNNode(geometry: cylinder)
        node.simdPosition = (start + end) / 2
        node.simdOrientation = simd_quatf(from: SIMD3<Float>(0, 1, 0), to: simd_normalize(delta))
        sceneView.scene.rootNode.addChildNode(node)
        lineNodes.append(node)
    }

    private func updateReadout(message: String? = nil) {
        if let message {
            statusLabel.text = message
            return
        }
        if points.count < 3 {
            statusLabel.text = "Point \(points.count) placed. Move to the next turf corner."
        } else {
            let squareFeet = polygonAreaSquareMeters(points) * 10.763_910_416_7
            let feet = polygonPerimeterMeters(points) * 3.280_839_895
            statusLabel.text = String(format: "%d points · %.1f sq ft · %.1f ft perimeter", points.count, squareFeet, feet)
        }
    }

    private func updateButtons() {
        undoButton.isEnabled = !points.isEmpty
        undoButton.alpha = points.isEmpty ? 0.45 : 1
        finishButton.isEnabled = points.count >= 3
        finishButton.alpha = points.count >= 3 ? 1 : 0.45
    }
}

private func polygonAreaSquareMeters(_ points: [SIMD3<Float>]) -> Double {
    guard points.count >= 3 else { return 0 }
    var crossSum = SIMD3<Double>(repeating: 0)
    for index in points.indices {
        let currentPoint = points[index]
        let nextPoint = points[(index + 1) % points.count]
        let current = SIMD3<Double>(Double(currentPoint.x), Double(currentPoint.y), Double(currentPoint.z))
        let next = SIMD3<Double>(Double(nextPoint.x), Double(nextPoint.y), Double(nextPoint.z))
        crossSum += simd_cross(current, next)
    }
    return simd_length(crossSum) * 0.5
}

private func polygonPerimeterMeters(_ points: [SIMD3<Float>]) -> Double {
    guard points.count >= 2 else { return 0 }
    return points.indices.reduce(0) { total, index in
        total + Double(simd_distance(points[index], points[(index + 1) % points.count]))
    }
}

import SwiftUI
import UIKit
import AVFoundation

struct CameraView: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.presentationMode) var presentationMode

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.delegate = context.coordinator
        picker.sourceType = .camera
        picker.cameraDevice = .rear
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraView

        init(_ parent: CameraView) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let uiImage = info[.originalImage] as? UIImage {
                parent.image = uiImage
            }
            parent.presentationMode.wrappedValue.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.presentationMode.wrappedValue.dismiss()
        }
    }
}

/// Uploads a hand photo to the Game Mode endpoint. The phone's fixed
/// table position (0-3) is sent as `pos`; the server resolves it to the
/// current hand's seat role via the rotating-dealer mapping.
class GameModeUploadService {
    struct GameModeResult {
        let status: String            // accepted | completed | archived | error
        let seatRole: String?
        let detectedCards: [String]
        let seatsFilledCount: Int
        let url: String?              // 52-char deck string when completed
        let errors: [String]
    }

    private let serverBase: String

    init(serverBase: String) {
        // Tolerate a trailing slash in the settings field.
        self.serverBase = serverBase.hasSuffix("/")
            ? String(serverBase.dropLast())
            : serverBase
    }

    func upload(image: UIImage, pos: Int, session: String,
                completion: @escaping (Result<GameModeResult, Error>) -> Void) {
        guard let imageData = image.jpegData(compressionQuality: 0.8),
              let url = URL(string: "\(serverBase)/api/game-mode/upload") else {
            completion(.failure(NSError(
                domain: "GameModeUpload", code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Bad server address"])))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func addField(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        addField("pos", String(pos))
        let trimmedSession = session.trimmingCharacters(in: .whitespaces)
        if !trimmedSession.isEmpty {
            addField("session", trimmedSession.uppercased())
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"image\"; filename=\"card_hand.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        URLSession.shared.dataTask(with: request) { data, _, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            guard let data = data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(.failure(NSError(
                    domain: "GameModeUpload", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Unreadable server response"])))
                return
            }
            let result = GameModeResult(
                status: obj["status"] as? String ?? "error",
                seatRole: obj["seatRole"] as? String,
                detectedCards: obj["detectedCards"] as? [String] ?? [],
                seatsFilledCount: (obj["seatsFilled"] as? [String])?.count ?? 0,
                url: obj["url"] as? String,
                errors: obj["errors"] as? [String]
                    ?? (obj["message"] as? String).map { [$0] }
                    ?? (obj["error"] as? String).map { [$0] }
                    ?? []
            )
            completion(.success(result))
        }.resume()
    }
}

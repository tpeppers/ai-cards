import SwiftUI

struct ContentView: View {
    @State private var showCamera = false
    @State private var capturedImage: UIImage?
    @State private var uploadStatus = "Ready to capture"
    @State private var uploadID: String?
    
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                Text("Hearts Card Capture")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .padding()
                
                Text("Take a photo of your 12-card hand")
                    .font(.headline)
                    .foregroundColor(.secondary)
                
                if let image = capturedImage {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxHeight: 300)
                        .cornerRadius(10)
                        .padding()
                } else {
                    Rectangle()
                        .fill(Color.gray.opacity(0.3))
                        .frame(height: 300)
                        .cornerRadius(10)
                        .overlay(
                            Text("No photo taken yet")
                                .foregroundColor(.secondary)
                        )
                        .padding()
                }
                
                Button("Take Photo") {
                    showCamera = true
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(showCamera)
                
                if capturedImage != nil {
                    Button("Upload to Server") {
                        uploadImage()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
                
                Text(uploadStatus)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
                
                if let uploadID = uploadID {
                    Text("Upload ID: \(uploadID)")
                        .font(.footnote)
                        .foregroundColor(.green)
                        .textSelection(.enabled)
                        .padding()
                }
                
                Spacer()
            }
            .navigationBarHidden(true)
            .sheet(isPresented: $showCamera) {
                CameraView(image: $capturedImage)
            }
        }
    }
    
    private func uploadImage() {
        guard let image = capturedImage else { return }
        
        uploadStatus = "Uploading..."
        
        let uploadService = ImageUploadService()
        uploadService.uploadImage(image: image) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let response):
                    self.uploadStatus = "Upload successful!"
                    self.uploadID = response.uuid
                case .failure(let error):
                    self.uploadStatus = "Upload failed: \(error.localizedDescription)"
                    self.uploadID = nil
                }
            }
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
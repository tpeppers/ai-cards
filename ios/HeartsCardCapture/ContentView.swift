import SwiftUI

/// Bid Whist Capture — photograph your 12-card hand and upload it to the
/// table's Game Mode server. Each phone is configured ONCE in Settings:
/// the server address and this phone's fixed table position (P1-P4).
/// The seat ROLE (dealer / 1st-3rd bidder) rotates server-side each hand
/// and is shown live on the main screen.
struct ContentView: View {
    // Persisted one-time setup
    @AppStorage("serverBase") private var serverBase: String = "http://192.168.1.100:3001"
    @AppStorage("tablePos") private var tablePos: Int = 0        // 0-3 → P1-P4
    @AppStorage("sessionCode") private var sessionCode: String = ""

    @State private var capturedImage: UIImage?
    @State private var showCamera = false
    @State private var showSettings = false
    @State private var uploading = false
    @State private var statusText = ""
    @State private var statusIsError = false
    @State private var detectedCards: [String] = []
    @State private var seatsFilled: Int = 0
    @State private var completedUrl: String?
    @State private var roleLabel: String = "…"

    private let roleNames = [
        "dealer": "Dealer", "bid1": "1st bidder",
        "bid2": "2nd bidder", "bid3": "3rd bidder",
    ]

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    // Position + live role banner
                    VStack(spacing: 4) {
                        Text("📍 You are P\(tablePos + 1)")
                            .font(.title2).bold()
                        Text("This hand you are: \(roleLabel)")
                            .font(.headline)
                            .foregroundColor(.orange)
                        Text("Photos in: \(seatsFilled)/4")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.purple.opacity(0.15))
                    .cornerRadius(12)

                    if let image = capturedImage {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 320)
                            .cornerRadius(8)
                    } else {
                        Text("Photograph your 12-card hand:\nfan the cards face up, shoot from above, good light.")
                            .multilineTextAlignment(.center)
                            .foregroundColor(.secondary)
                            .padding(.vertical, 40)
                    }

                    Button(action: { showCamera = true }) {
                        Label("Take Photo", systemImage: "camera.fill")
                            .frame(maxWidth: .infinity)
                            .padding()
                    }
                    .buttonStyle(.borderedProminent)

                    if capturedImage != nil {
                        Button(action: uploadImage) {
                            if uploading {
                                ProgressView().frame(maxWidth: .infinity).padding()
                            } else {
                                Label("Upload", systemImage: "arrow.up.circle.fill")
                                    .frame(maxWidth: .infinity)
                                    .padding()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                        .disabled(uploading)
                    }

                    if !statusText.isEmpty {
                        Text(statusText)
                            .font(.callout)
                            .foregroundColor(statusIsError ? .red : .primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if !detectedCards.isEmpty {
                        Text("Detected \(detectedCards.count) cards: \(detectedCards.joined(separator: ", "))")
                            .font(.footnote.monospaced())
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if let url = completedUrl {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Hand complete! Deck string:").font(.caption).bold()
                            Text(url)
                                .font(.caption2.monospaced())
                                .textSelection(.enabled)
                            Button("Copy") {
                                UIPasteboard.general.string = url
                            }
                            .buttonStyle(.bordered)
                        }
                        .padding()
                        .background(Color.green.opacity(0.15))
                        .cornerRadius(8)
                    }
                }
                .padding()
            }
            .navigationTitle("Bid Whist Capture")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showCamera) {
                CameraView(image: $capturedImage)
            }
            .sheet(isPresented: $showSettings) {
                SettingsView(serverBase: $serverBase, tablePos: $tablePos, sessionCode: $sessionCode)
            }
            .onAppear(perform: fetchTable)
        }
        .navigationViewStyle(.stack)
    }

    private func fetchTable() {
        guard let url = URL(string: "\(serverBase)/api/game-mode/table") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let roles = obj["posRoles"] as? [String],
                  tablePos < roles.count else {
                DispatchQueue.main.async { roleLabel = "…" }
                return
            }
            let filled = (obj["seatsFilled"] as? [String])?.count ?? 0
            DispatchQueue.main.async {
                roleLabel = roleNames[roles[tablePos]] ?? roles[tablePos]
                seatsFilled = filled
            }
        }.resume()
    }

    private func uploadImage() {
        guard let image = capturedImage else { return }
        uploading = true
        statusText = "Uploading…"
        statusIsError = false
        detectedCards = []
        completedUrl = nil

        let service = GameModeUploadService(serverBase: serverBase)
        service.upload(image: image, pos: tablePos, session: sessionCode) { result in
            DispatchQueue.main.async {
                uploading = false
                switch result {
                case .success(let r):
                    detectedCards = r.detectedCards
                    seatsFilled = r.seatsFilledCount
                    if r.status == "completed", let url = r.url {
                        completedUrl = url
                        statusText = "Hand complete — all 4 photos in."
                    } else if r.status == "accepted" {
                        let role = roleNames[r.seatRole ?? ""] ?? (r.seatRole ?? "")
                        statusText = "Recorded as \(role). \(r.seatsFilledCount)/4 photos in."
                        if r.detectedCards.count != 12 {
                            statusText += " ⚠️ \(r.detectedCards.count) cards detected — fix on the Upload page (EDIT) or retake."
                        }
                    } else {
                        statusIsError = true
                        statusText = r.errors.first ?? "Upload problem (\(r.status))."
                    }
                    fetchTable()
                case .failure(let err):
                    statusIsError = true
                    statusText = "Can't reach the server — check WiFi and the server address in Settings. (\(err.localizedDescription))"
                }
            }
        }
    }
}

struct SettingsView: View {
    @Binding var serverBase: String
    @Binding var tablePos: Int
    @Binding var sessionCode: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Server"),
                        footer: Text("Your laptop's LAN IP, e.g. http://192.168.1.42:3001 — or http://10.42.0.1:3001 on the hotspot.")) {
                    TextField("http://192.168.1.100:3001", text: $serverBase)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
                Section(header: Text("My table position"),
                        footer: Text("Positions go clockwise around the table. Set once — the dealer role rotates automatically.")) {
                    Picker("Position", selection: $tablePos) {
                        ForEach(0..<4, id: \.self) { p in
                            Text("P\(p + 1)").tag(p)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                Section(header: Text("Session code (rarely needed)"),
                        footer: Text("Leave blank in normal single-table play.")) {
                    TextField("ABCDEF", text: $sessionCode)
                        .autocapitalization(.allCharacters)
                        .disableAutocorrection(true)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
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

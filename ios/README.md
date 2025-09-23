# Hearts Card Capture iOS App

This iOS application allows users to take photos of their 12-card Hearts hands and upload them to the web server for processing.

## Features

- Camera access for capturing card hand photos
- Image upload to API server
- UUID receipt system for tracking uploads
- Simple, clean SwiftUI interface

## Building the App

### On macOS with Xcode:
1. Open `HeartsCardCapture.xcodeproj` in Xcode
2. Select your target device or simulator
3. Build and run the project (Cmd+R)

### From command line (macOS only):
```bash
cd ios
xcodebuild -project HeartsCardCapture.xcodeproj -scheme HeartsCardCapture -configuration Release -derivedDataPath ./build -destination generic/platform=iOS clean build
```

### Creating an Archive for Distribution:
```bash
xcodebuild -project HeartsCardCapture.xcodeproj -scheme HeartsCardCapture -configuration Release -archivePath ./HeartsCardCapture.xcarchive archive
```

## Configuration

The app is configured to connect to the API server at `http://localhost:3001/api/upload`. 

For production deployment, update the server URL in `CameraView.swift`:
```swift
guard let url = URL(string: "https://your-production-server.com/api/upload") else {
```

## Permissions

The app requires camera permissions to function. The permission request is configured in `Info.plist` with the key `NSCameraUsageDescription`.

## Testing

To test the app:
1. Ensure the API server is running (`npm run server` from the project root)
2. Build and run the iOS app
3. Grant camera permissions when prompted
4. Take a photo and upload it
5. Check the server logs to confirm the upload was received
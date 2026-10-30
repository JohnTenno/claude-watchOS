import SwiftUI

/// Grid of the photos the iPhone uploaded in the last day; tapping one hands it back to the chat.
struct PhonePhotoGridView: View {
    let onSelect: (PhonePhoto) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var photos: [PhonePhoto]?
    @State private var errorText: String?
    private let service = ChatService()

    var body: some View {
        ScrollView {
            if let errorText {
                Text(errorText).font(.footnote).foregroundStyle(.red)
            } else if let photos, photos.isEmpty {
                Text("No hay fotos del iPhone de las últimas 24 h").font(.footnote).foregroundStyle(.secondary)
            } else if let photos {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                    ForEach(photos) { photo in
                        PhonePhotoCell(photo: photo, service: service) { selected in
                            onSelect(selected)
                            dismiss()
                        }
                    }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Fotos del iPhone")
        .task {
            do {
                photos = try await service.phonePhotos()
            } catch {
                errorText = error.localizedDescription
            }
        }
    }
}

/// One thumbnail, made by the relay; downloads when it scrolls into view.
private struct PhonePhotoCell: View {
    let photo: PhonePhoto
    let service: ChatService
    let onTap: (PhonePhoto) -> Void
    @State private var thumbnail: Data?

    var body: some View {
        Button {
            var selected = photo
            selected.thumbnail = thumbnail
            onTap(selected)
        } label: {
            ZStack {
                if let thumbnail, let image = UIImage(data: thumbnail) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    ProgressView()
                }
            }
            .frame(height: 70)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .disabled(thumbnail == nil)
        .accessibilityLabel("Foto del iPhone")
        .task { thumbnail = try? await service.phonePhotoThumbnail(id: photo.id) }
    }
}

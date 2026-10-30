import SwiftUI

struct ChatView: View {
    @State private var model: ChatViewModel
    @State private var draft = ""

    init(conversationId: String?) {
        _model = State(initialValue: ChatViewModel(conversationId: conversationId))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(model.messages) { MessageBubble(message: $0).id($0.id) }
                    if model.isSending || model.isLoading {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                    if let data = model.pendingPhoto?.thumbnail, let image = UIImage(data: data) {
                        HStack {
                            Image(uiImage: image).resizable().scaledToFit().frame(height: 50)
                            Spacer()
                            Button("Quitar", systemImage: "xmark") { model.pendingPhoto = nil }
                                .labelStyle(.iconOnly)
                            Button("Enviar", systemImage: "paperplane.fill") { model.send(draft); draft = "" }
                                .labelStyle(.iconOnly)
                        }
                        .disabled(model.isSending)
                    }
                    TextField("Escribe…", text: $draft)
                        .disabled(model.isSending)
                        .onSubmit {
                            model.send(draft)
                            draft = ""
                        }
                    NavigationLink {
                        PhonePhotoGridView { model.pendingPhoto = $0 }
                    } label: {
                        Label("Fotos del iPhone", systemImage: "iphone")
                    }
                    .disabled(model.isSending)
                    .id("input")
                }
            }
            .onChange(of: model.messages.count) {
                withAnimation { proxy.scrollTo("input", anchor: .bottom) }
            }
        }
        .navigationTitle(model.conversationId == nil ? "Nueva" : "Chat")
        .task { await model.load() }
    }
}

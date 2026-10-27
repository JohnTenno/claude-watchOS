import SwiftUI

struct ConversationListView: View {
    @State private var model = ConversationListViewModel()

    var body: some View {
        List {
            if let usage = model.usage {
                UsageView(usage: usage)
            } else if model.usageUnavailable {
                Text("Uso no disponible").font(.footnote).foregroundStyle(.secondary)
            }
            NavigationLink {
                ChatView(conversationId: nil)
            } label: {
                Label("Nueva conversación", systemImage: "square.and.pencil")
            }
            if let errorText = model.errorText {
                Text(errorText).font(.footnote).foregroundStyle(.red)
            }
            ForEach(model.conversations) { conversation in
                NavigationLink {
                    ChatView(conversationId: conversation.id)
                } label: {
                    Text(conversation.title).lineLimit(2)
                }
            }
        }
        .navigationTitle("Claude")
        // onAppear (not task) also fires when coming back from a chat, so new conversations and usage show up.
        .onAppear { Task { await model.refresh() } }
    }
}

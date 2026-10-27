import SwiftUI

struct MessageBubble: View {
    let message: Message

    var body: some View {
        Text(message.text)
            .font(.footnote)
            .padding(8)
            .background(background, in: RoundedRectangle(cornerRadius: 10))
            .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }

    private var background: Color {
        switch message.role {
        case .user: .blue.opacity(0.6)
        case .assistant: .gray.opacity(0.3)
        case .error: .red.opacity(0.5)
        }
    }
}

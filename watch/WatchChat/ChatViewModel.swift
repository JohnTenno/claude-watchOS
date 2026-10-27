import Foundation
import Observation

@MainActor
@Observable
final class ChatViewModel {
    private(set) var messages: [Message] = []
    private(set) var isSending = false
    private(set) var isLoading = false
    /// nil until the first reply of a new conversation.
    private(set) var conversationId: String?
    private let service: ChatService

    init(conversationId: String?, service: ChatService = ChatService()) {
        self.conversationId = conversationId
        self.service = service
    }

    func load() async {
        guard let conversationId, messages.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            messages = try await service.messages(of: conversationId)
        } catch {
            messages = [Message(role: .error, text: error.localizedDescription)]
        }
    }

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        messages.append(Message(role: .user, text: trimmed))
        isSending = true
        Task {
            defer { isSending = false }
            do {
                let result = try await service.send(trimmed, conversationId: conversationId)
                conversationId = result.conversationId
                messages.append(Message(role: .assistant, text: result.reply))
            } catch {
                messages.append(Message(role: .error, text: error.localizedDescription))
            }
        }
    }
}

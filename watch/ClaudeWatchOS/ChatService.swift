import Foundation

/// Talks to the Mac relay server, which forwards messages to Claude Code.
final class ChatService {
    /// `photoId` names an iPhone photo already on the relay, which hands the original to Claude.
    private struct ChatRequest: Encodable { let text: String; let conversationId: String?; let photoId: String? }
    private struct ChatResponse: Decodable { let reply: String; let conversationId: String }
    private struct ErrorResponse: Decodable { let error: String }
    private struct ConversationDetail: Decodable { let messages: [Message] }

    struct ServerError: LocalizedError {
        let errorDescription: String?
    }

    /// Returns the reply and the conversation id to use for the next message.
    func send(_ text: String, photoId: String?, conversationId: String?) async throws -> (reply: String, conversationId: String) {
        let body = try JSONEncoder().encode(ChatRequest(text: text, conversationId: conversationId, photoId: photoId))
        let response: ChatResponse = try await request("chat", method: "POST", body: body, timeout: 320)
        return (response.reply, response.conversationId)
    }

    func conversations() async throws -> [ConversationSummary] {
        try await request("conversations")
    }

    func messages(of conversationId: String) async throws -> [Message] {
        let detail: ConversationDetail = try await request("conversations/\(conversationId)")
        return detail.messages
    }

    /// Photos the iPhone Shortcut uploaded in the last day, newest first.
    func phonePhotos() async throws -> [PhonePhoto] {
        try await request("photos")
    }

    func phonePhotoThumbnail(id: String) async throws -> Data {
        struct Thumbnail: Decodable { let thumbnail: Data }
        let response: Thumbnail = try await request("photos/\(id)")
        return response.thumbnail
    }

    func usage() async throws -> Usage {
        try await request("usage")
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil,
                                       timeout: TimeInterval = 30) async throws -> T {
        var request = URLRequest(url: Config.serverURL.appendingPathComponent(path), timeoutInterval: timeout)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(Config.token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
            throw ServerError(errorDescription: message ?? "Error del servidor (\(status))")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

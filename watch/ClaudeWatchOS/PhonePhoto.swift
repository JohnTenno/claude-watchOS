import Foundation

/// A photo the iPhone uploaded to the relay on its own (kept there for 1 day). The original stays on the relay;
/// the watch only handles its id and a small thumbnail.
struct PhonePhoto: Identifiable, Decodable {
    let id: String
    var thumbnail: Data?

    private enum CodingKeys: String, CodingKey { case id }
}

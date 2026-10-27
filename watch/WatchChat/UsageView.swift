import SwiftUI

/// Remaining subscription usage: 5-hour session and weekly limit.
struct UsageView: View {
    let usage: Usage

    var body: some View {
        HStack {
            if let session = usage.session { gauge(session, label: "Sesión") }
            Spacer()
            if let weekly = usage.weekly { gauge(weekly, label: "Semana") }
        }
    }

    private func gauge(_ window: Usage.Window, label: String) -> some View {
        let remaining = max(0, 100 - window.usedPercent)
        return VStack(spacing: 2) {
            Gauge(value: remaining, in: 0...100) {
                Text(label)
            } currentValueLabel: {
                Text("\(Int(remaining))")
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(color(remaining))
            Text(label).font(.caption2)
            if let reset = window.resetDate {
                Text(reset, format: resetFormat(reset)).font(.system(size: 10)).foregroundStyle(.secondary)
            }
        }
    }

    // Same thresholds as TouchBarStats: green > 40, yellow 15–40, red < 15.
    private func color(_ remaining: Double) -> Color {
        remaining > 40 ? .green : remaining >= 15 ? .yellow : .red
    }

    private func resetFormat(_ date: Date) -> Date.FormatStyle {
        Calendar.current.isDateInToday(date)
            ? .dateTime.hour().minute()
            : .dateTime.weekday(.abbreviated).hour()
    }
}

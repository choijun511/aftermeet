// 用 CoreGraphics 画 AfterMeet 图标,输出 1024x1024 PNG。
// 设计:绿色圆角方(macOS squircle 风格,带留白)+ 白色对勾 + 三根声波竖条。
// 用法: swift generate-icon.swift /tmp/icon_1024.png

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/icon_1024.png"
let S = 1024

let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(
  data: nil, width: S, height: S, bitsPerComponent: 8, bytesPerRow: 0,
  space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { fatalError("ctx") }

func color(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> CGColor {
  CGColor(colorSpace: cs, components: [CGFloat(r), CGFloat(g), CGFloat(b), CGFloat(a)])!
}

// 透明背景
ctx.clear(CGRect(x: 0, y: 0, width: S, height: S))

// 圆角方(留白 ~9%,圆角 ~22%)
let margin: CGFloat = 92
let rect = CGRect(x: margin, y: margin, width: CGFloat(S) - margin * 2, height: CGFloat(S) - margin * 2)
let radius: CGFloat = rect.width * 0.235
let squircle = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

// 垂直渐变绿
ctx.saveGState()
ctx.addPath(squircle)
ctx.clip()
let grad = CGGradient(colorsSpace: cs, colors: [
  color(0.235, 0.62, 0.34),   // 上 亮绿
  color(0.16, 0.50, 0.27)     // 下 深绿
] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: rect.maxY), end: CGPoint(x: 0, y: rect.minY), options: [])
ctx.restoreGState()

let cx = CGFloat(S) / 2
let cy = CGFloat(S) / 2

// 白色对勾(粗圆头折线),整体偏上
ctx.setStrokeColor(color(1, 1, 1))
ctx.setLineWidth(74)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)
let checkY = cy + 70
ctx.beginPath()
ctx.move(to: CGPoint(x: cx - 168, y: checkY))
ctx.addLine(to: CGPoint(x: cx - 44, y: checkY - 120))
ctx.addLine(to: CGPoint(x: cx + 192, y: checkY + 150))
ctx.strokePath()

// 三根声波竖条(对勾下方,半透明白),示意「实时转写」
let barW: CGFloat = 40
let gap: CGFloat = 36
let baseY = cy - 250
let heights: [CGFloat] = [70, 130, 95]
let totalW = barW * 3 + gap * 2
var bx = cx - totalW / 2
for (i, h) in heights.enumerated() {
  let a = 0.55 + Double(i) * 0.12
  ctx.setFillColor(color(1, 1, 1, a))
  let bar = CGRect(x: bx, y: baseY, width: barW, height: h)
  ctx.addPath(CGPath(roundedRect: bar, cornerWidth: barW / 2, cornerHeight: barW / 2, transform: nil))
  ctx.fillPath()
  bx += barW + gap
}

guard let img = ctx.makeImage() else { fatalError("img") }
let url = URL(fileURLWithPath: outPath)
guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
  fatalError("dest")
}
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
print("wrote \(outPath)")

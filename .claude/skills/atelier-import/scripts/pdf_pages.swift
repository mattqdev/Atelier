// Render every page of a pdf to png with macOS PDFKit (no Ghostscript/poppler needed).
// Usage: swift pdf_pages.swift <file.pdf> <outDir> [scale=2]
// Writes <outDir>/page-01@2x.png … (the @Nx suffix tells import_assets.py the scale).
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("usage: swift pdf_pages.swift <file.pdf> <outDir> [scale]\n".data(using: .utf8)!)
    exit(1)
}
let out = URL(fileURLWithPath: args[2])
let scale = args.count > 3 ? Double(args[3]) ?? 2 : 2
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let digits = max(2, String(doc.pageCount).count)

for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let box = page.bounds(for: .cropBox)
    let w = Int((box.width * scale).rounded()), h = Int((box.height * scale).rounded())
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let ctx = NSGraphicsContext(bitmapImageRep: rep) else { continue }
    let cg = ctx.cgContext
    cg.setFillColor(NSColor.white.cgColor)
    cg.fill(CGRect(x: 0, y: 0, width: w, height: h))
    cg.scaleBy(x: scale, y: scale)
    cg.translateBy(x: -box.minX, y: -box.minY)
    page.draw(with: .cropBox, to: cg)
    let name = String(format: "page-%0\(digits)d@%gx.png", i + 1, scale)
    try rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent(name))
    print(name)
}

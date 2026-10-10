// pdf_vectors.swift <file.pdf> <out_dir>   (macOS, no install: uses CoreGraphics + PDFKit)
//
// For each page writes:
//   page-N.svg  every vector path with its fill/stroke colour, opacity and transform,
//               in page units (1 pt = 1 px for design-tool exports); text exported as
//               outlines shows up as glyph paths whose first command "M x y Z" is the
//               text origin on the baseline; images are marked with <!-- IMAGE … -->
//   page-N.txt  text lines (PDFKit bounds + font size) and a log of images, clips
//               (Figma clips strokes to their frame) and soft masks.
// Then run pdf_layout.py on the output folder.
import Foundation
import PDFKit
import CoreGraphics

struct GState {
  var ctm = CGAffineTransform.identity
  var fill = "#000000", stroke = "#000000"
  var fillA: CGFloat = 1, strokeA: CGFloat = 1
  var lw: CGFloat = 1, cap = 0, join = 0
  var dash: [CGFloat] = []
}

final class Ctx {
  var gs = GState()
  var stack: [GState] = []
  var path = ""
  var out: [String] = []
  var log: [String] = []
  var cur = CGPoint.zero
  var page: CGPDFPage
  var res: [CGPDFDictionaryRef] = []
  var streams: [CGPDFContentStreamRef] = []
  var H: CGFloat
  init(page: CGPDFPage, H: CGFloat) { self.page = page; self.H = H }
  func pt(_ x: CGFloat, _ y: CGFloat) -> String {
    let p = CGPoint(x: x, y: y).applying(gs.ctm)
    return String(format: "%.2f %.2f", p.x, H - p.y)
  }
  func emit(fill: Bool, stroke: Bool, evenOdd: Bool = false) {
    guard !path.isEmpty else { return }
    var a = "d=\"\(path)\""
    a += fill ? " fill=\"\(gs.fill)\"" + (gs.fillA < 1 ? String(format: " fill-opacity=\"%.3f\"", gs.fillA) : "") : " fill=\"none\""
    if evenOdd && fill { a += " fill-rule=\"evenodd\"" }
    if stroke {
      // stroke width scaled by the CTM (uniform scale assumed)
      let s = sqrt(abs(gs.ctm.a * gs.ctm.d - gs.ctm.b * gs.ctm.c))
      a += String(format: " stroke=\"%@\" stroke-width=\"%.2f\"", gs.stroke, gs.lw * s)
      if gs.strokeA < 1 { a += String(format: " stroke-opacity=\"%.3f\"", gs.strokeA) }
      a += [" stroke-linecap=\"butt\"", " stroke-linecap=\"round\"", " stroke-linecap=\"square\""][min(gs.cap, 2)]
      a += [" stroke-linejoin=\"miter\"", " stroke-linejoin=\"round\"", " stroke-linejoin=\"bevel\""][min(gs.join, 2)]
    }
    out.append("<path \(a)/>")
    path = ""
  }
}

func ctx(_ info: UnsafeMutableRawPointer?) -> Ctx { Unmanaged<Ctx>.fromOpaque(info!).takeUnretainedValue() }
func nums(_ s: CGPDFScannerRef, _ n: Int) -> [CGFloat] {
  var r = [CGFloat](repeating: 0, count: n)
  for i in (0..<n).reversed() { var v: CGPDFReal = 0; CGPDFScannerPopNumber(s, &v); r[i] = v }
  return r
}
func hex(_ c: [CGFloat]) -> String {
  if c.isEmpty { return "#FF00FF" }
  if c.count < 3 { let v = Int(round(c[0] * 255)); return String(format: "#%02X%02X%02X", v, v, v) }
  if c.count == 4 { // cmyk → rgb (rough)
    let k = c[3]; return hex([(1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k)])
  }
  return String(format: "#%02X%02X%02X", Int(round(c[0] * 255)), Int(round(c[1] * 255)), Int(round(c[2] * 255)))
}
// colour operands: count numbers on the stack (sc/scn may end with a name)
func popColor(_ s: CGPDFScannerRef) -> [CGFloat] {
  // a failed typed pop still consumes the operand, so pop generic objects
  var r: [CGFloat] = []
  var obj: CGPDFObjectRef? = nil
  while CGPDFScannerPopObject(s, &obj), let o = obj {
    switch CGPDFObjectGetType(o) {
    case .real: var v: CGPDFReal = 0; CGPDFObjectGetValue(o, .real, &v); r.insert(v, at: 0)
    case .integer: var v: CGPDFInteger = 0; CGPDFObjectGetValue(o, .integer, &v); r.insert(CGFloat(v), at: 0)
    case .name: return []
    default: return r
    }
  }
  return r
}

let table = CGPDFOperatorTableCreate()!
func op(_ name: String, _ cb: @escaping CGPDFOperatorCallback) { CGPDFOperatorTableSetCallback(table, name, cb) }

op("q") { _, i in let c = ctx(i); c.stack.append(c.gs) }
op("Q") { _, i in let c = ctx(i); if let g = c.stack.popLast() { c.gs = g } }
op("cm") { s, i in let c = ctx(i); let n = nums(s, 6)
  c.gs.ctm = CGAffineTransform(a: n[0], b: n[1], c: n[2], d: n[3], tx: n[4], ty: n[5]).concatenating(c.gs.ctm) }
op("w") { s, i in ctx(i).gs.lw = nums(s, 1)[0] }
op("J") { s, i in ctx(i).gs.cap = Int(nums(s, 1)[0]) }
op("j") { s, i in ctx(i).gs.join = Int(nums(s, 1)[0]) }
op("m") { s, i in let c = ctx(i); let n = nums(s, 2); c.path += "M\(c.pt(n[0], n[1])) "; c.cur = CGPoint(x: n[0], y: n[1]) }
op("l") { s, i in let c = ctx(i); let n = nums(s, 2); c.path += "L\(c.pt(n[0], n[1])) "; c.cur = CGPoint(x: n[0], y: n[1]) }
op("c") { s, i in let c = ctx(i); let n = nums(s, 6)
  c.path += "C\(c.pt(n[0], n[1])) \(c.pt(n[2], n[3])) \(c.pt(n[4], n[5])) "; c.cur = CGPoint(x: n[4], y: n[5]) }
op("v") { s, i in let c = ctx(i); let n = nums(s, 4)
  c.path += "C\(c.pt(c.cur.x, c.cur.y)) \(c.pt(n[0], n[1])) \(c.pt(n[2], n[3])) "; c.cur = CGPoint(x: n[2], y: n[3]) }
op("y") { s, i in let c = ctx(i); let n = nums(s, 4)
  c.path += "C\(c.pt(n[0], n[1])) \(c.pt(n[2], n[3])) \(c.pt(n[2], n[3])) "; c.cur = CGPoint(x: n[2], y: n[3]) }
op("h") { _, i in ctx(i).path += "Z " }
op("re") { s, i in let c = ctx(i); let n = nums(s, 4)
  c.path += "M\(c.pt(n[0], n[1])) L\(c.pt(n[0] + n[2], n[1])) L\(c.pt(n[0] + n[2], n[1] + n[3])) L\(c.pt(n[0], n[1] + n[3])) Z " }
op("f") { _, i in ctx(i).emit(fill: true, stroke: false) }
op("F") { _, i in ctx(i).emit(fill: true, stroke: false) }
op("f*") { _, i in ctx(i).emit(fill: true, stroke: false, evenOdd: true) }
op("S") { _, i in ctx(i).emit(fill: false, stroke: true) }
op("s") { _, i in let c = ctx(i); c.path += "Z "; c.emit(fill: false, stroke: true) }
op("B") { _, i in ctx(i).emit(fill: true, stroke: true) }
op("B*") { _, i in ctx(i).emit(fill: true, stroke: true, evenOdd: true) }
op("b") { _, i in let c = ctx(i); c.path += "Z "; c.emit(fill: true, stroke: true) }
op("n") { _, i in let c = ctx(i); c.log.append("clip/n: \(c.path.prefix(160))"); c.path = "" }
op("rg") { s, i in ctx(i).gs.fill = hex(nums(s, 3)) }
op("RG") { s, i in ctx(i).gs.stroke = hex(nums(s, 3)) }
op("g") { s, i in ctx(i).gs.fill = hex(nums(s, 1)) }
op("G") { s, i in ctx(i).gs.stroke = hex(nums(s, 1)) }
op("k") { s, i in ctx(i).gs.fill = hex(nums(s, 4)) }
op("K") { s, i in ctx(i).gs.stroke = hex(nums(s, 4)) }
op("sc") { s, i in let v = popColor(s); if !v.isEmpty { ctx(i).gs.fill = hex(v) } else { ctx(i).log.append("pattern fill") } }
op("scn") { s, i in let v = popColor(s); if !v.isEmpty { ctx(i).gs.fill = hex(v) } else { ctx(i).log.append("pattern fill") } }
op("SC") { s, i in let v = popColor(s); if !v.isEmpty { ctx(i).gs.stroke = hex(v) } }
op("SCN") { s, i in let v = popColor(s); if !v.isEmpty { ctx(i).gs.stroke = hex(v) } }
op("gs") { s, i in
  let c = ctx(i); var name: UnsafePointer<CChar>? = nil
  guard CGPDFScannerPopName(s, &name), let name = name, let res = c.res.last else { return }
  var egs: CGPDFDictionaryRef? = nil, g: CGPDFDictionaryRef? = nil
  guard CGPDFDictionaryGetDictionary(res, "ExtGState", &egs), let egs = egs,
        CGPDFDictionaryGetDictionary(egs, name, &g), let g = g else { return }
  var v: CGPDFReal = 1
  if CGPDFDictionaryGetNumber(g, "ca", &v) { c.gs.fillA = v }
  if CGPDFDictionaryGetNumber(g, "CA", &v) { c.gs.strokeA = v }
  var sm: CGPDFDictionaryRef? = nil
  if CGPDFDictionaryGetDictionary(g, "SMask", &sm) { c.log.append("soft mask in gs \(String(cString: name))") }
}
op("Do") { s, i in let c = ctx(i); var name: UnsafePointer<CChar>? = nil; CGPDFScannerPopName(s, &name)
  let nm = String(cString: name!)
  var xo: CGPDFDictionaryRef? = nil, st: CGPDFStreamRef? = nil
  guard let res = c.res.last, CGPDFDictionaryGetDictionary(res, "XObject", &xo), let xo = xo,
        CGPDFDictionaryGetStream(xo, nm, &st), let st = st, let d = CGPDFStreamGetDictionary(st) else { return }
  var sub: UnsafePointer<CChar>? = nil; CGPDFDictionaryGetName(d, "Subtype", &sub)
  let m = c.gs.ctm
  if let sub = sub, String(cString: sub) == "Form" {
    let saved = c.gs; c.stack.append(saved)
    var mat: CGPDFArrayRef? = nil
    if CGPDFDictionaryGetArray(d, "Matrix", &mat), let mat = mat {
      var v = [CGFloat](repeating: 0, count: 6)
      for k in 0..<6 { var r: CGPDFReal = 0; CGPDFArrayGetNumber(mat, k, &r); v[k] = r }
      c.gs.ctm = CGAffineTransform(a: v[0], b: v[1], c: v[2], d: v[3], tx: v[4], ty: v[5]).concatenating(c.gs.ctm)
    }
    var r2: CGPDFDictionaryRef? = nil
    let fres = CGPDFDictionaryGetDictionary(d, "Resources", &r2) ? r2! : res
    c.res.append(fres)
    var grp: CGPDFDictionaryRef? = nil
    if CGPDFDictionaryGetDictionary(d, "Group", &grp) { c.out.append("<!-- group \(nm) alpha=\(c.gs.fillA) -->") }
    let cs = CGPDFContentStreamCreateWithStream(st, fres, c.streams.last!)
    c.streams.append(cs)
    let sc = CGPDFScannerCreate(cs, table, i)
    CGPDFScannerScan(sc)
    c.streams.removeLast(); c.res.removeLast()
    c.gs = c.stack.popLast()!
    return
  }
  var w: CGPDFInteger = 0, h: CGPDFInteger = 0
  CGPDFDictionaryGetInteger(d, "Width", &w); CGPDFDictionaryGetInteger(d, "Height", &h)
  c.log.append(String(format: "IMAGE %@ %dx%d px at x=%.1f y=%.1f w=%.1f h=%.1f", nm, w, h, m.tx, c.H - m.ty - m.d, m.a, m.d))
  c.out.append(String(format: "<!-- IMAGE %@ %dx%d x=%.1f y=%.1f w=%.1f h=%.1f -->", nm, w, h, m.tx, c.H - m.ty - m.d, m.a, m.d)) }
op("sh") { s, i in let c = ctx(i); var name: UnsafePointer<CChar>? = nil; CGPDFScannerPopName(s, &name)
  c.log.append("SHADING \(String(cString: name!)) ctm=\(c.gs.ctm)") }
op("W") { _, i in let c = ctx(i); c.log.append("clip W: \(c.path.prefix(160))") }
op("W*") { _, i in let c = ctx(i); c.log.append("clip W*: \(c.path.prefix(160))") }

let args = CommandLine.arguments
let url = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let cg = CGPDFDocument(url as CFURL)!
let kit = PDFDocument(url: url)!
for n in 1...cg.numberOfPages {
  let page = cg.page(at: n)!
  let box = page.getBoxRect(.mediaBox)
  let c = Ctx(page: page, H: box.height)
  var pres: CGPDFDictionaryRef? = nil
  CGPDFDictionaryGetDictionary(page.dictionary!, "Resources", &pres); c.res = [pres!]
  let stream = CGPDFContentStreamCreateWithPage(page)
  c.streams = [stream]
  let scanner = CGPDFScannerCreate(stream, table, Unmanaged.passUnretained(c).toOpaque())
  CGPDFScannerScan(scanner)
  let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \(Int(box.width)) \(Int(box.height))\">\n" + c.out.joined(separator: "\n") + "\n</svg>\n"
  try! svg.write(to: outDir.appendingPathComponent("page-\(n).svg"), atomically: true, encoding: .utf8)
  // text lines via PDFKit
  var txt = ""
  let kp = kit.page(at: n - 1)!
  if let sel = kp.selection(for: kp.bounds(for: .mediaBox)) {
    for line in sel.selectionsByLine() {
      let b = line.bounds(for: kp)
      var size = ""
      if let a = line.attributedString, a.length > 0, let f = a.attribute(.font, at: 0, effectiveRange: nil) as? NSFont { size = String(format: "%.1f", f.pointSize) }
      txt += String(format: "x=%.1f y=%.1f w=%.1f h=%.1f size=%@ | %@\n", b.minX, box.height - b.maxY, b.width, b.height, size, (line.string ?? "").replacingOccurrences(of: "\n", with: " "))
    }
  }
  txt += "\n-- log --\n" + c.log.joined(separator: "\n") + "\n"
  try! txt.write(to: outDir.appendingPathComponent("page-\(n).txt"), atomically: true, encoding: .utf8)
  print("page \(n): \(c.out.count) paths, \(c.log.count) log lines")
}

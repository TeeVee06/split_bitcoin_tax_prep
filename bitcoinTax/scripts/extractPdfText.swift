import Foundation
import PDFKit

guard CommandLine.arguments.count >= 2 else {
    fputs("Missing PDF path.\n", stderr)
    exit(1)
}

let pdfPath = CommandLine.arguments[1]
let pdfUrl = URL(fileURLWithPath: pdfPath)

guard let document = PDFDocument(url: pdfUrl) else {
    fputs("Unable to open PDF document.\n", stderr)
    exit(1)
}

for pageIndex in 0..<document.pageCount {
    print("__PDF_PAGE_\(pageIndex + 1)__")

    guard let page = document.page(at: pageIndex) else {
      continue
    }

    let pageText = page.string ?? ""
    print(pageText)
}

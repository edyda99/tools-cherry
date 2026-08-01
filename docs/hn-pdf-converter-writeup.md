# A 19-page PDF that took 655 seconds per page, and the 2x2 pixel images behind it

A PDF-to-Word conversion job started failing on one particular file. Nineteen pages,
3.4 MB, a perfectly ordinary business report. It hit the converter's 60 second timeout.
We raised the timeout to 180 seconds. It hit that too.

That is already the interesting part. A 3.4 MB document is not large. Nineteen pages is
not many. Whatever was happening did not scale with either of the two numbers you would
normally reach for.

Reproducing it locally made things worse rather than better. Converting a **single page**
of that document took **655 seconds**. No timeout was going to rescue this file. Something
about it was pathological, not merely slow.

## Counting the wrong things first

The converter's backend is [pdf2docx](https://pypi.org/project/pdf2docx/), which sits on
PyMuPDF. A sampling profiler put essentially all of the time inside
`ImagesExtractor.extract_images`. So: images. Fine, but the report had maybe forty
pictures in it, charts and a logo and some screenshots. Forty images should not cost ten
minutes a page.

So we counted properly, walking the pdf.js operator list and tallying every image paint
operation. The answer was **2,068**.

Two thousand images in a document that visibly contains forty.

## What Microsoft Word actually stores

Here is the part that is genuinely counterintuitive, and it took a while to accept.

When Word exports a PDF with a shaded table cell, it does not write a fill colour. It
writes **a 2x2 pixel image, stretched over the whole cell**, one per shaded cell, each
carrying a full-size soft mask. A table with a few hundred shaded cells becomes a few
hundred embedded images. The Lambda's source comment records **897 such chips against 40
actual pictures** in this document.

They are invisible as images. They render as a colour. They are, structurally, images.

## Why a few hundred of them is quadratic

pdf2docx does something reasonable that turns out to be a trap here. Its
`ImagesExtractor` collects every image occurrence on a page, groups them by **pairwise
bounding-box intersection**, which is quadratic in the number of occurrences, and then
**re-renders the page region for every intersecting group at 3x resolution**.

Now consider what shaded table cells look like geometrically. They are adjacent. Adjacent
cells all intersect each other. So a few hundred chips do not decompose into a few
hundred small groups, they collapse into a small number of enormous groups, and each one
triggers a full-page re-render at 3x. That is where 655 seconds a page comes from. The
work is not in the images, it is in the page renders the images provoke.

## Why the existing guard did not catch it

pdf2docx already has an "ignore small images" test. It never fired once.

The test measures the **drawn bounding box**, and rejects images whose bbox area is 4 or
less. A shading chip's drawn bbox is cell-sized, which is to say large. It looks like a
big image. The only thing that gives it away is its **intrinsic** size, the 2x2 it is
stored at before being stretched.

That distinction, intrinsic pixels versus drawn rectangle, is the whole bug. Filter on
the rectangle and you catch nothing. Filter on the intrinsic size and you catch every
chip and no real picture.

## The fix, and the number it bought

One monkeypatch, applied process-wide before pdf2docx loads, because pdf2docx reaches
every image through the same call:

```python
def _install_fill_chip_filter():
    original = fitz.Page.get_images

    def get_images(self, full=False):
        return [im for im in original(self, full=full) if im[2] * im[3] > TINY_IMAGE_PX]

    fitz.Page.get_images = get_images
```

`TINY_IMAGE_PX = 64`, so anything 8x8 intrinsic or smaller is treated as a fill rather
than a picture. The cost is a cell background colour. The benefit, per the code comment
written when it landed: the same report **finishes in 4 seconds**, with its text, 20
tables and 22 real images intact.

Three minutes of timeout to four seconds, by not doing work that never had a purpose.

## The twist: the fix was wrong

This is the part worth sitting with.

The conversion was now fast. It was also **empty**. Correct tables, correct structure, no
words in them.

The document's body text had no text layer at all. It had been through a sanitizer, and
every line of body text was drawn as a **1-bit glyph stencil**: the exact same 2x2 colour
chip, stretched over the text line, masked by a 600-dpi bitmap of the glyph shapes. The
shading chips and the text were the same kind of object. The filter that made the file
fast was deleting the document.

So the real fix was not a filter, it was recovery: a module that runs tesseract per
merged stencil block rather than per page, because full-page layout analysis loses half
the words inside bordered tables while the stencil rectangles say exactly where the text
is. OCR words become real positioned text, colour sampled from the chip, size fitted to
the width the glyphs occupy, weight inferred from measured stem thickness. Shading chips
become actual vector rectangle fills.

Two follow-on bugs came straight out of the monkeypatch, and both are the same lesson.
First, the stencil detector looks for exactly the chips the filter hides, so patching
`get_images` globally **blinded the detector to its own input**. It now receives the
unpatched original explicitly. Second, these files also carry the document's real words
as hidden zero-advance text, which pdf2docx would happily emit a second time, in the
wrong place, on top of the recovered text.

A process-wide monkeypatch is a blunt instrument. It fixed one consumer and broke the
next two.

## An unrelated landmine, for anyone using this stack

pdf2docx 0.5.8 declares PyMuPDF as `>=1.19.0`. PyMuPDF 1.26 removed `Rect.get_area()`,
which pdf2docx still calls in `ImagesExtractor`. An unpinned rebuild produces a converter
where **every** conversion fails instantly with `'Rect' object has no attribute
'get_area'`. The requirements file now pins `PyMuPDF==1.25.5`.

## Refusing the work early

There is a cheap version of all this on the client. Before offering a server conversion,
the page walks the operator list of the **first three pages only** and counts image
paints, skipping any `paintImageXObject` whose intrinsic width times height is 64 or
less, matching the server's rule exactly. Over 400 real pictures and it declines up
front.

Three pages rather than the whole document is deliberate: reading a page's operator list
costs roughly 600ms on an image-dense page, so a full scan would tax every conversion
with ten seconds of "checking". A document dense enough to fail is dense from page one.

## The client-side tradeoff, honestly

The default path in this converter runs entirely in the browser: vendored pdf.js reads
the text layer, the vendored `docx` library builds the .docx, nothing is uploaded.

What that costs is real and worth stating plainly. The browser path reads the text layer
and reconstructs lines and paragraphs from glyph positions, inferring headings from
relative font size. It does not rebuild tables. It does not carry images across. It
cannot do OCR, so a scanned page produces nothing at all. It is a text extractor with
paragraph structure, not a layout-faithful converter.

What it buys is equally real. The file never leaves the device, so there is no upload, no
retention question, no queue, no per-user quota, and no timeout because it is the user's
own CPU. The size ceiling is 50 MB rather than the 25 MB the server accepts, for exactly
that reason.

The server path exists only for what the browser genuinely cannot do, which is read text
out of a picture. It is capped at 25 MB, 50 pages, and a small number of conversions per
user per day, because it is OCR on someone else's hardware and that has to be paid for.

For completeness: this is the PDF-to-Word converter on tools-berry.com, and all of the
code quoted above is in that repository.

The thing I keep coming back to is that the whole investigation was misdirected by a
reasonable assumption. Conversion cost tracks file size and page count, except when it
tracks object count, and object count can be three orders of magnitude away from what the
document appears to contain, because a word processor decided that a background colour is
a picture.

/**
 * Spoolyard's static assets (spec library, PDF font, DWG writer) live beside index.html, so the same build
 * works at a site root, under /spoolyard/ inside BidWright, on GitHub Pages and from the desktop app.
 */
export const assetUrl = (path: string) => new URL(path, document.baseURI).toString();

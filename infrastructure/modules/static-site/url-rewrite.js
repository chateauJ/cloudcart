// CloudFront viewer-request function (cloudfront-js-2.0). The Next.js static export writes each
// page as <route>/index.html, but S3 behind OAC only resolves index.html at the root, so page URLs
// are mapped here: /products and /products/ both become /products/index.html. Anything with a file
// extension (JS, CSS, images, the __next.*.txt navigation payloads) passes through untouched.
// frontend/scripts/serve-static.mjs applies the same rule for local previews.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (uri.split("/").pop().indexOf(".") === -1) {
    request.uri = uri + "/index.html";
  }

  return request;
}

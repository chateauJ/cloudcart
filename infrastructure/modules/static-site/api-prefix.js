// CloudFront viewer-request function (cloudfront-js-2.0) for the /api/* behaviours. The storefront
// calls its own origin at /api/..., and the HTTP API serves its routes at the root, so the prefix
// is dropped on the way through: /api/products/prod_001 reaches the API as /products/prod_001.
// The behaviours only match /api/*, so every URI here starts with "/api/".
function handler(event) {
  var request = event.request;
  request.uri = request.uri.slice(4);
  return request;
}

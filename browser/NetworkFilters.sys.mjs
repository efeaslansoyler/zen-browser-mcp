export function networkFilter({ urlPattern, method, status, resource_type }) {
  const methods = method === undefined ? null : new Set([].concat(method).map((value) => value.toUpperCase()));
  const types = resource_type === undefined ? null : new Set([].concat(resource_type));
  const matchesStatus = (code) => {
    if (status === undefined) return true;
    if (code == null) return false;
    if (typeof status === "number") return code === status;
    return Math.floor(code / 100) === Number(status[0]);
  };
  return (request) =>
    (!urlPattern || request.url.includes(urlPattern)) &&
    (!methods || methods.has(request.method)) &&
    (!types || types.has(request.type)) &&
    matchesStatus(request.status);
}

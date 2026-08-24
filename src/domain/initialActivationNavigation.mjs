export function resolveInitialActivationRoute({
  activeBusinessId,
  destination,
  initialBusinessId,
  pathname,
}) {
  if (!initialBusinessId || initialBusinessId !== activeBusinessId) {
    return { status: "inactive", destination: "" };
  }

  if (!destination) {
    return { status: "prompt", destination: "" };
  }

  if (pathname !== destination) {
    return { status: "redirect", destination };
  }

  return { status: "settled", destination };
}

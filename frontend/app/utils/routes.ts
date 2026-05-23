export function isStudyEditRoute(pathname: string | null | undefined): boolean {
  return /^\/studies\/[^/]+\/edit$/.test(pathname ?? '');
}

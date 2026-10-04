/** Static CSS layers: gradient, grid and vignette. Sits behind the 3D scene. */
export function Background() {
  return (
    <div className="bg" aria-hidden="true">
      <div className="bg__gradient" />
      <div className="bg__grid" />
      <div className="bg__vignette" />
    </div>
  )
}

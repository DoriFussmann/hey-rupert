// Left half of the split-screen auth pages (login, set password). Styles live
// in app/login/login.css.
export function AuthBrandPanel() {
  return (
    <div className="bp-panel" aria-hidden="true">
      <div className="bp-panel__lighting"></div>
      <div className="bp-panel__grid"></div>

      <div className="bp-panel__middle">
        <svg className="bp-panel__mark" viewBox="0 0 450 450" aria-hidden="true">
          <path
            fill="currentColor"
            transform="translate(26.5 12.0)"
            d="M120.0 396.8C120.0 380.7 119.7 330.8 119.3 285.9L118.7 204.4L160.6 181.5C197.1 161.7 228.0 144.7 286.0 112.7C339.3 83.4 395.4 53.0 396.3 53.0C396.7 53.0 397.0 103.6 397.0 165.4L397.0 277.8L381.2 286.3C372.6 291.0 326.8 315.6 279.5 341.0C232.2 366.4 186.3 391.2 177.5 396.0C153.9 408.8 121.4 426.0 120.7 426.0C120.3 426.0 120.0 412.8 120.0 396.8ZM0.7 268.8C1.0 209.8 1.5 161.2 1.9 160.9C2.2 160.5 25.0 148.0 52.5 133.0C80.0 118.1 112.2 100.5 124.0 94.0C147.9 80.9 195.9 54.8 209.0 47.8C213.7 45.3 235.4 33.5 257.2 21.6C279.1 9.7 297.2 -0.0 297.5 -0.0C297.8 -0.0 298.0 15.9 298.0 35.3L298.0 70.5L292.3 73.7C282.8 78.8 222.0 111.8 167.0 141.7C138.7 157.1 108.4 173.5 99.8 178.1L84.0 186.5L84.0 259.5L84.0 332.5L77.2 336.0C73.5 338.0 55.1 347.7 36.4 357.8C17.6 367.8 1.8 376.0 1.2 376.0C0.4 376.0 0.2 346.8 0.7 268.8Z"
          />
        </svg>
        <p className="bp-panel__title">Rupert</p>
        <p className="bp-panel__subcopy">The right investors. Reached right.</p>
      </div>

      <p className="bp-panel__footer">
        Human-led. Tailor-made. Fully transparent.
      </p>
    </div>
  );
}

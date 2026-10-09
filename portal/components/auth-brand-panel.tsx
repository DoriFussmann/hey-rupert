// Left half of the split-screen auth pages (login, set password). Styles live
// in app/login/login.css.
export function AuthBrandPanel() {
  return (
    <div className="bp-panel" aria-hidden="true">
      <div className="bp-panel__lighting"></div>
      <div className="bp-panel__grid"></div>

      <div className="bp-panel__middle">
        <p className="bp-panel__title">Rupert</p>
        <p className="bp-panel__subcopy">Investor outreach, managed for you.</p>
      </div>

      <p className="bp-panel__footer">
        Human-led. Tailor-made. Fully transparent.
      </p>
    </div>
  );
}

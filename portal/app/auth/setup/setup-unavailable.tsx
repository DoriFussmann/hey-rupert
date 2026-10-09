import Link from "next/link";

export function SetupUnavailable({ message }: { message: string }) {
  return (
    <div className="bp-fields">
      <h1 className="bp-card__title">Set your password</h1>
      <p className="bp-text" role="alert">
        {message}
      </p>
      <p className="bp-text">
        Already set your password?{" "}
        <Link className="bp-link" href="/login">
          Log in
        </Link>
      </p>
    </div>
  );
}

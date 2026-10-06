export function FormFeedback({
  state,
}: {
  state: { ok?: boolean; message?: string; error?: string };
}) {
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  }
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  return null;
}

import { startTransition, type FormEvent } from "react";

/**
 * Envía un formulario sin el reinicio automático de React 19: tras la acción,
 * `form.reset()` desmarca también las casillas controladas y vacía lo escrito
 * tras un error. Conserva el botón que envió (`name`/`value`, p. ej. `intent`).
 * Sin JS queda `action` como respaldo.
 */
export function submitKeepingState(dispatch: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(data));
  };
}

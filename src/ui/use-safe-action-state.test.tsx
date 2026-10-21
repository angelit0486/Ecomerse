// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OFFLINE_MESSAGE, UNREACHABLE_MESSAGE, useSafeActionState } from "./use-safe-action-state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type State = { ok?: boolean; error?: string; values?: Record<string, string> };

function Form({ action }: { action: (s: State, f: FormData) => Promise<State> }) {
  const [state, formAction] = useSafeActionState<State, FormData>(action, {});
  return (
    <form action={formAction}>
      <input name="name" aria-label="Nombre" defaultValue={state.values?.name ?? ""} />
      <button type="submit">Guardar</button>
      <p role="alert">{state.error}</p>
    </form>
  );
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  });
}

describe("useSafeActionState", () => {
  it("sin conexión: avisa y devuelve lo escrito en lugar de romper la pantalla", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<Form action={() => Promise.reject(new TypeError("Failed to fetch"))} />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Termos" } });
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(OFFLINE_MESSAGE);
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Termos");
  });

  it("con conexión pero sin respuesta del servidor: otro aviso, también accionable", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<Form action={() => Promise.reject(new Error("boom"))} />);
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(UNREACHABLE_MESSAGE);
  });

  it("deja pasar redirect() y notFound() de Next", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/x;307;",
    });
    const onError = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    class Boundary extends (await import("react")).Component<
      { children: React.ReactNode },
      { failed: boolean }
    > {
      override state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      override componentDidCatch(e: unknown) {
        onError(e);
      }
      override render() {
        return this.state.failed ? <p>atrapado</p> : this.props.children;
      }
    }
    render(
      <Boundary>
        <Form action={() => Promise.reject(redirect)} />
      </Boundary>,
    );
    await submit();
    expect(onError).toHaveBeenCalledWith(redirect);
  });

  it("si la acción responde, su estado pasa tal cual", async () => {
    render(<Form action={async () => ({ error: "Revisa el nombre." })} />);
    await submit();
    expect(screen.getByRole("alert").textContent).toBe("Revisa el nombre.");
  });

  it("con un error sin valores (sesión vencida), conserva lo escrito salvo lo sensible", async () => {
    function Probe() {
      const [state, formAction] = useSafeActionState<State, FormData>(
        async () => ({ error: "Tu sesión terminó." }),
        {},
      );
      return (
        <form action={formAction}>
          <input name="name" aria-label="Nombre" defaultValue={state.values?.name ?? ""} />
          <input name="password" type="password" defaultValue="secreta" />
          <button type="submit">Guardar</button>
          <output>{JSON.stringify(state.values ?? null)}</output>
        </form>
      );
    }
    render(<Probe />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Termos" } });
    await submit();
    expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual({ name: "Termos" });
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Termos");
  });

  it("conserva el código de un cupón y el último valor de una casilla con su hidden", async () => {
    function Coupon() {
      const [state, formAction] = useSafeActionState<State, FormData>(
        async () => ({ error: "Tu sesión terminó." }),
        {},
      );
      return (
        <form action={formAction}>
          <input name="code" aria-label="Código" defaultValue={state.values?.code ?? ""} />
          <input type="hidden" name="is_active" value="0" />
          <input type="checkbox" name="is_active" value="1" defaultChecked aria-label="Activo" />
          <input name="otp_code" defaultValue="123456" />
          <button type="submit">Guardar</button>
          <output>{JSON.stringify(state.values ?? null)}</output>
        </form>
      );
    }
    render(<Coupon />);
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "VERANO10" } });
    await submit();
    expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual({
      code: "VERANO10",
      is_active: "1",
    });
  });

  it("sin red no arrastra los errores de campo del intento anterior", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    function Fields() {
      const [state, formAction] = useSafeActionState<
        State & { fields?: Record<string, string> },
        FormData
      >(async () => {
        calls += 1;
        if (calls === 1) return { error: "Revisa el nombre.", fields: { name: "Muy corto" } };
        throw new TypeError("Failed to fetch");
      }, {});
      return (
        <form action={formAction}>
          <button type="submit">Guardar</button>
          <p role="alert">{state.error}</p>
          <p>{state.fields?.name ?? "sin error de campo"}</p>
        </form>
      );
    }
    render(<Fields />);
    await submit();
    expect(screen.getByText("Muy corto")).toBeTruthy();
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(OFFLINE_MESSAGE);
    expect(screen.getByText("sin error de campo")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "./dialog";
import { Field } from "./field";
import { Select } from "./select";
import { Table, TBody, TD, TH, THead, TR } from "./table";
import { ToastProvider, useToast } from "./toast";

afterEach(cleanup);

beforeAll(() => {
  // APIs que jsdom no implementa y Radix usa.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

/** Sin violaciones serias ni críticas de accesibilidad (axe). */
async function expectAccessible(container: Element = document.body) {
  const result = await axe.run(container, {
    rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
  });
  const serious = result.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

describe("Dialog", () => {
  it("se abre con nombre y descripción accesibles, y Escape lo cierra", async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Quitar miembro</Button>
        </DialogTrigger>
        <DialogContent title="¿Quitar a Ana?" description="Perderá el acceso a la tienda.">
          <DialogClose asChild>
            <Button>Cancelar</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Quitar miembro" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Quitar a Ana?" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    await expectAccessible();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Select dentro de Field", () => {
  it("el HTML del servidor no trae atributos style (la CSP los bloquea y ensucia la consola)", () => {
    const html = renderToString(
      <Select
        name="timezone"
        defaultValue="b"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    expect(html).not.toContain("style=");
    expect(html).toContain('name="timezone"');
  });

  it("controlado: avisa el valor elegido", () => {
    const onValueChange = vi.fn();
    render(
      <Select
        aria-label="Fuente"
        value="a"
        onValueChange={onValueChange}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Fuente" }), { target: { value: "b" } });
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("recibe la etiqueta y el error del campo", async () => {
    render(
      <Field label="Rol" error="Elige un rol">
        {(control) => (
          <Select
            {...control}
            name="role"
            options={[
              { value: "viewer", label: "Solo lectura" },
              { value: "catalog_manager", label: "Catálogo" },
            ]}
          />
        )}
      </Field>,
    );
    const trigger = screen.getByRole("combobox", { name: "Rol" });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toContain("-error");
    await expectAccessible();
  });
});

describe("Table", () => {
  it("tiene caption y encabezados con scope", async () => {
    render(
      <Table caption="Equipo de la tienda" captionHidden>
        <THead>
          <TR>
            <TH>Nombre</TH>
            <TH>Rol</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>Ana</TD>
            <TD>Dueña</TD>
          </TR>
        </TBody>
      </Table>,
    );
    expect(screen.getByRole("table", { name: "Equipo de la tienda" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Nombre" }).getAttribute("scope")).toBe("col");
    await expectAccessible();
  });
});

describe("Toast", () => {
  function Trigger() {
    const toast = useToast();
    return (
      <Button onClick={() => toast({ title: "Invitación enviada", tone: "success" })}>
        Invitar
      </Button>
    );
  }

  it("muestra el aviso en una región anunciable", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Invitar" }));
    });
    expect((await screen.findAllByText("Invitación enviada")).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: /Notificaciones/ })).toBeTruthy();
  });

  it("useToast fuera del proveedor falla con un mensaje claro", () => {
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./home-actions", () => ({
  saveHomeDraft: vi.fn(),
  requestBannerUpload: vi.fn(),
  finalizeBannerUpload: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { HeroNotice } from "./home-editor";

afterEach(cleanup);

const hero = (id: string, enabled: boolean) => ({ id, type: "hero" as const, enabled });

describe("HeroNotice (DIAGNOSTICO-PORTADA R2)", () => {
  it("portada principal oculta: lo dice y la vuelve a mostrar con un clic", () => {
    const onShow = vi.fn();
    render(<HeroNotice sections={[hero("a", false)]} onShow={onShow} />);
    expect(screen.getByRole("status").textContent).toMatch(/oculta: tus clientes no la ven/);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar la portada principal" }));
    expect(onShow).toHaveBeenCalledWith("a");
  });

  it("dos portadas visibles: avisa que se verán una debajo de otra", () => {
    render(<HeroNotice sections={[hero("a", true), hero("b", true)]} onShow={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/2 portadas principales visibles/);
  });

  it("una visible (con o sin otra oculta) o ninguna: sin aviso", () => {
    const { container, rerender } = render(
      <HeroNotice sections={[hero("a", false), hero("b", true)]} onShow={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
    rerender(<HeroNotice sections={[]} onShow={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});

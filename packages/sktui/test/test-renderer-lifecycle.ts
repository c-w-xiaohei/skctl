export type TestRenderer = {
  readonly renderer: {
    destroy(): void;
  };
};

const liveRenderers = new Set<TestRenderer["renderer"]>();

export function trackTestRenderer<T extends TestRenderer>(setup: T): T {
  const renderer = setup.renderer;
  const destroy = renderer.destroy.bind(renderer);
  let destroyed = false;

  renderer.destroy = () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    liveRenderers.delete(renderer);
    destroy();
  };
  liveRenderers.add(renderer);
  return setup;
}

export function destroyTrackedRenderers(): void {
  const errors: unknown[] = [];
  for (const renderer of liveRenderers) {
    try {
      renderer.destroy();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Failed to destroy test renderers");
  }
}

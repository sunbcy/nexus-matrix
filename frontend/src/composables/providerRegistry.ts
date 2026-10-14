// Provider 注册表。新增图库只需在这里加一行。
import type { ImageProvider } from './imageProviders';
import { unsplashProvider } from './providers/unsplash';

export const PROVIDERS: ImageProvider[] = [unsplashProvider];

export const getProvider = (id: string): ImageProvider | undefined =>
  PROVIDERS.find((p) => p.id === id);

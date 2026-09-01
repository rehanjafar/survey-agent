export type InteractiveControlKind =
  "button" | "checkbox" | "number" | "radio" | "select" | "text" | "textarea" | "other";

export interface SelectChoice {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly selected: boolean;
}

export interface InteractiveControl {
  readonly kind: InteractiveControlKind;
  readonly selector: string;
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly value: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly required: boolean;
  readonly options: readonly SelectChoice[];
}

export interface PageState {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly controls: readonly InteractiveControl[];
}

export interface NavigationState {
  readonly previousUrl: string;
  readonly url: string;
  readonly navigated: boolean;
}

export interface BrowserSession {
  navigate(url: string): Promise<PageState>;
  capturePageState(): Promise<PageState>;
  click(selector: string): Promise<void>;
  type(selector: string, value: string): Promise<void>;
  selectDropdown(selector: string, value: string): Promise<void>;
  selectRadio(selector: string): Promise<void>;
  setCheckbox(selector: string, checked: boolean): Promise<void>;
  waitForNavigation(previousUrl: string, timeoutMs?: number): Promise<NavigationState>;
  clickAndDetectNavigation(selector: string, timeoutMs?: number): Promise<NavigationState>;
  currentUrl(): string;
  close(): Promise<void>;
}

export interface BrowserSessionOptions {
  readonly reuseContext?: boolean;
}

export interface BrowserAutomationDriver {
  launch(): Promise<void>;
  createSession(options?: BrowserSessionOptions): Promise<BrowserSession>;
  close(): Promise<void>;
}

export interface ChromiumBrowserOptions {
  readonly allowedDomains?: readonly string[];
  readonly headless?: boolean;
  readonly maxPageTextLength?: number;
}

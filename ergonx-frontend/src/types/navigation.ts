export interface NavigationItem {
  label: string;
  href: string;
  icon: string;
  roles?: string[];
  module?: string;
  children?: NavigationItem[];
}

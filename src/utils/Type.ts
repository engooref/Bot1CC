export type JSONComponent =
  | StringSelectJSON
  | ChannelSelectJSON
  | RoleSelectJSON
  | ButtonJSON
  | ModalJSON;

export enum JSONTypeComponent {
    StringSelectMenu = "StringSelectMenu",
    ChannelSelectMenu = "ChannelSelectMenu",
    RoleSelectMenu = "RoleSelectMenu",
    Button = "Button",
    Modal = "Modal",
}

interface BaseJSON {
  customId: string;
}

export interface StringSelectJSON extends BaseJSON {
  minValues?: number;
  maxValues?: number;
  type: JSONTypeComponent.StringSelectMenu;
  placeholder?: string;
  default?: string;
  options?: {
    label: string;
    value: string;
    description?: string;
  }[];
  other?: {
    name: string;
    value: any;
    other?: any;
  }[];
}

interface ChannelSelectJSON extends BaseJSON {
  type: JSONTypeComponent.ChannelSelectMenu;
  placeholder?: string;
  default?: string[];
  channelTypes?: ("GUILD_TEXT" | "GUILD_VOICE" | "GUILD_CATEGORY" | "GUILD_NEWS" | "GUILD_STORE")[];
}

interface RoleSelectJSON extends BaseJSON {
  type: JSONTypeComponent.RoleSelectMenu;
  placeholder?: string;
  default?: string[];

}

interface ButtonJSON extends BaseJSON {
  type: JSONTypeComponent.Button;
  label: string;
  style: "Primary" | "Secondary" | "Success" | "Danger" | "Link";
  url?: string;
  disabled?: boolean;
  target?: string;
  
}

export interface ModalField {
  customId: string;
  label: string;
  style: "Short" | "Paragraph";
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  default?: string;

}

interface ModalJSON extends BaseJSON {
  type: JSONTypeComponent.Modal;
  title: string;
  fields: ModalField[];
}
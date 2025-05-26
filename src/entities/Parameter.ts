// src/entities/Parameter.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  ManyToMany,
  Collection,
  type Rel,
} from '@mikro-orm/core';
import { ParameterType } from './ParameterType.js';
import { Channel }       from './Channel.js';
import { Role }          from './Role.js';

@Entity({ tableName: 'parameter' })
export class Parameter {

  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name!: string;

  /** lien vers le type de paramètre */
  @ManyToOne(() => ParameterType, {} )
  valueType!: ParameterType;

  /** valeur canal, facultative */
  @ManyToOne(() => Channel, { nullable: true })
  valueChannel?: Rel<Channel>;

  @ManyToMany(() => Role, role => role.parameters, {
    owner: true,
    pivotTable: 'parameter_role',
  })
  roles = new Collection<Role>(this);

  @Property({ length: 255, nullable: true })
  valueText?: string;

  /**
   * Retourne la valeur selon le typeParam
   */
  getValue(): string | string[] {
    switch (this.valueType.type_param) {
      case 'Text':
        return this.valueText ?? '';
      case 'Channel':
        return this.valueChannel?.discordId ?? '';          // on utilise discordId, pas discord_id
      case 'Role':
        return this.roles.getItems().map(r => r.discordId);
      default:
        return '';
    }
  }

  

}


import {Entity, PrimaryKey, Property, } from '@mikro-orm/core';
  
@Entity({ tableName: 'parameter_type' })
export class ParameterType {

    @PrimaryKey()
    id!: number;
    ;

    @Property({ length: 255 })
    type_param! : string;

}

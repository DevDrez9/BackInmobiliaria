import { IsString, IsUUID } from 'class-validator';

export class CreateSubscriptionOrderDto {
  @IsString()
  @IsUUID()
  planId: string;
}

export class CreateProductOrderDto {
  @IsString()
  @IsUUID()
  productId: string;

  @IsString()
  @IsUUID()
  propertyId: string;
}

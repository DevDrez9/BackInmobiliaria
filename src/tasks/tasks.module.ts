import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [CatalogModule],
  providers: [TasksService],
})
export class TasksModule {}

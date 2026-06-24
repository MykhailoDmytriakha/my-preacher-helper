import { NextResponse } from 'next/server';

import { seriesRepository } from '@repositories/series.repository';
import { sermonsRepository } from '@repositories/sermons.repository';

// DELETE /api/sermons/:id - Delete a sermon
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const sermon = await sermonsRepository.fetchSermonById(id);
    if (!sermon) {
      return NextResponse.json({ message: 'Проповедь уже отсутствует' }, { status: 200 });
    }

    // Delete the sermon from database
    await sermonsRepository.deleteSermonById(id);

    // Remove references to this sermon from all series
    try {
      await seriesRepository.removeSermonFromAllSeries(id);
      console.log(`Successfully cleaned up references to deleted sermon ${id}`);
    } catch (cleanupError) {
      console.error(`Failed to clean up references for deleted sermon ${id}:`, cleanupError);
      // Don't fail the entire operation if cleanup fails
    }

    return NextResponse.json({ message: 'Проповедь успешно удалена' }, { status: 200 });
  } catch (error: unknown) {
    console.error(`Ошибка при удалении проповеди ${id}:`, error);
    return NextResponse.json(
      { message: 'Не удалось удалить проповедь', error: (error as Error).message },
      { status: 500 }
    );
  }
}

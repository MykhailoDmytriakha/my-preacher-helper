import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';

// PUT /api/sermons/[id]/preach-dates/[dateId]
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; dateId: string }> }
) {
    const { id, dateId } = await params;
    try {
        const updates = await request.json();

        // Basic validation to prevent updating id or createdAt
        delete (updates as any).id;
        delete (updates as any).createdAt;

        const preachDate = await sermonsRepository.updatePreachDate(id, dateId, updates);
        return NextResponse.json({ preachDate });
    } catch (error: any) {
        console.error(`Error updating preach date ${dateId} in sermon ${id}:`, error);
        if (error.message === "Sermon not found" || error.message === "Preach date not found") {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to update preach date' }, { status: 500 });
    }
}

// DELETE /api/sermons/[id]/preach-dates/[dateId]
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; dateId: string }> }
) {
    const { id, dateId } = await params;
    try {
        await sermonsRepository.deletePreachDate(id, dateId);
        return NextResponse.json({ message: 'Preach date deleted' });
    } catch (error: any) {
        console.error(`Error deleting preach date ${dateId} from sermon ${id}:`, error);
        if (error.message === "Sermon not found") {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to delete preach date' }, { status: 500 });
    }
}

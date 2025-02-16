"use client";

import { useEffect, useState } from "react";
import { getSermons } from "@services/sermon.service";
import { auth } from "@services/firebaseAuth.service";
import AddSermonModal from "@components/AddSermonModal";
import { Sermon } from "@/models/models";
import SermonList from "@components/dashboard/SermonList";

export default function DashboardPage() {
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const currentUser = auth.currentUser;
      let uid: string | undefined;
      if (currentUser) {
        uid = currentUser.uid;
      } else {
        try {
          const guestData = localStorage.getItem("guestUser");
          if (guestData) {
            uid = JSON.parse(guestData).uid;
          }
        } catch (error) {
          console.error("Error parsing guestUser from localStorage", error);
        }
      }
      if (uid) {
        const fetchedSermons = await getSermons(uid);
        setSermons(fetchedSermons);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Мои проповеди
        </h1>
        <AddSermonModal
          onNewSermonCreated={(newSermon: Sermon) =>
            setSermons((prevSermons) => [newSermon, ...prevSermons])
          }
        />
      </div>
      
      {/* Sermons List */}
      <SermonList sermons={sermons} onDelete={(id: string) =>
        setSermons((prev) => prev.filter((s) => s.id !== id))
      } onUpdate={(updatedSermon: Sermon) => setSermons(prev => prev.map(s => s.id === updatedSermon.id ? updatedSermon : s))} />
    </div>
  );
}

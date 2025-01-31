export interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: {
    text: string;
    tag: 'introduction' | 'main' | 'conclusion';
    createdAt: Date;
  }[];
  structure?: string;
}

export const getSermons = async (): Promise<Sermon[]> => {
  // В реальном приложении здесь будет fetch к API
  return [
    {
      id: '1',
      title: "Проповедь о благодати",
      verse: "Рим 12:1-2: \"Итак умоляю вас, братия, милосердием Божиим, представьте тела ваши в жертву живую, святую, благоугодную Богу, для разумного служения вашего, и не сообразуйтесь с веком сим, но преобразуйтесь обновлением ума вашего, чтобы вам познавать, что есть воля Божия, благая, угодная и совершенная.\"",
      date: "12 ноября 2024",
      thoughts: [
        {
          text: "Важно начать с объяснения концепции благодати",
          tag: "introduction",
          createdAt: new Date("2024-11-12T09:23:00")
        },
        // {
        //     text: "Важно начать с объяснения концепции благодати",
        //     tag: "introduction",
        //     createdAt: new Date("2024-11-12T09:23:10")
        // },
        {
          text: "Пример из жизни апостола Павла",
          tag: "main",
          createdAt: new Date("2024-11-12T10:15:00")
        },
        {
          text: "Связь между благодатью и ежедневной жизнью христианина",
          tag: "main",
          createdAt: new Date("2024-11-12T11:45:00")
        },
        {
          text: "Призыв к практическому применению учения",
          tag: "conclusion",
          createdAt: new Date("2024-11-12T12:30:00")
        }
      ],
      structure: "1. Введение в концепцию благодати\n2. Библейские примеры\n3. Практическое применение\n4. Заключительный призыв"
    
    },
    {
      id: '2',
      title: "Любовь Божья",
      verse: "Иоанна 3:16: \"Ибо так возлюбил Бог мир, что отдал Сына Своего Единородного, дабы всякий верующий в Него не погиб, но имел жизнь вечную.\"",
      date: "5 декабря 2024",
      thoughts: [
        {
          text: "История создания мира как проявление любви",
          tag: "introduction",
          createdAt: new Date("2024-12-05T08:10:00")
        },
        {
          text: "Анализ стиха Иоанна 3:16 в контексте Ветхого Завета",
          tag: "main",
          createdAt: new Date("2024-12-05T09:30:00")
        },
        {
          text: "Современные примеры проявления Божьей любви",
          tag: "main",
          createdAt: new Date("2024-12-05T10:45:00")
        }
      ],
      structure: "1. Божья любовь в творении\n2. Жертва Христа\n3. Проявления любви сегодня"
    },
    {
      id: '3',
      title: "Спасение по вере",
      verse: "Еф 2:8-22: \"Ибо благодатью вы спасены через веру, и сие не от вас, Божий дар: не от дел, чтобы никто не хвалился. Ибо мы — Его творение, созданы во Христе Иисусе на добрые дела, которые Бог предназначил нам исполнять. Итак помните, что вы, некогда язычники по плоти, которых называли необрезанными так называемые обрезанные плотским обрезанием, совершаемым руками, что вы были в то время без Христа, отчуждены от общества Израильского, чужды заветов обетования, не имели надежды и были безбожники в мире. А теперь во Христе Иисусе вы, бывшие некогда далеко, стали близки Кровию Христовою. Ибо Он есть мир наш, соделавший из обоих одно и разрушивший стоявшую посреди преграду, упразднив вражду Плотию Своею, а закон заповедей учением, дабы из двух создать в Себе Самом одного нового человека, устрояя мир, и в одном теле примирить обоих с Богом посредством креста, убив вражду на нем. И, придя, благовествовал мир вам, дальним и близким, потому что через Него и те и другие имеем доступ к Отцу, в одном Духе. Итак вы уже не чужие и не пришельцы, но сограждане святым и свои Богу, быв утверждены на основании Апостолов и пророков, имея Самого Иисуса Христа краеугольным камнем, на котором все здание, слагаясь стройно, возрастает в святый храм в Господе, на котором и вы устрояетесь в жилище Божие Духом.\"",
      date: "20 января 2025",
      thoughts: [
        {
          text: "Различие между верой и делами",
          tag: "introduction",
          createdAt: new Date("2025-01-20T14:00:00")
        },
        {
          text: "Анализ греческого оригинала слова 'вера'",
          tag: "main",
          createdAt: new Date("2025-01-20T14:45:00")
        },
        {
          text: "Примеры веры из жизни Давида",
          tag: "main",
          createdAt: new Date("2025-01-20T15:30:00")
        },
        {
          text: "Как развивать веру в современном мире",
          tag: "conclusion",
          createdAt: new Date("2025-01-20T16:15:00")
        }
      ]
    }
  ];
};
export const getSermonById = async (id: string): Promise<Sermon | undefined> => {
  const sermons = await getSermons();
  return sermons.find(sermon => sermon.id === id);
};

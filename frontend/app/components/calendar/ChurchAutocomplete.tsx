"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import ChurchField from "@/components/church/ChurchField";
import { Church } from "@/models/models";

interface ChurchAutocompleteProps {
    initialValue?: Church;
    onChange: (church: Church) => void;
}

/**
 * The Calendar's church input: the shared picker plus a city row.
 *
 * The name row is NOT reimplemented here. It is `ChurchField`, the single church picker
 * the app has — the create-sermon form embeds the same one, so history, "no match" and
 * the free-text fallback behave identically in both places. Only the city row is extra,
 * and only Calendar has the room for it.
 */
export default function ChurchAutocomplete({
    initialValue,
    onChange
}: ChurchAutocompleteProps) {
    const { t } = useTranslation();
    const [church, setChurch] = useState<Church>(
        initialValue ?? { id: "", name: "", city: "" }
    );

    const publish = (next: Church) => {
        setChurch(next);
        onChange(next);
    };

    return (
        <div className="space-y-4">
            <ChurchField
                id="church-name"
                value={church.name ? church : undefined}
                // Clearing the name keeps the city the person already typed: they are
                // editing one record, and an empty name is not a reason to lose the city.
                onChange={(next) => publish({ id: next?.id ?? church.id, name: next?.name ?? "", city: next?.city || church.city || "" })}
                showHistoryCount
                inputClassName="w-full rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />

            <div>
                <label
                    htmlFor="church-city"
                    className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                    {t('calendar.city')}
                </label>
                <input
                    id="church-city"
                    type="text"
                    value={church.city || ""}
                    onChange={(e) => publish({ ...church, city: e.target.value })}
                    placeholder={t('calendar.churchAutocomplete.cityPlaceholder')}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                />
            </div>
        </div>
    );
}

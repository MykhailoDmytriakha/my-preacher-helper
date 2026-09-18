"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import ChurchField from "@/components/church/ChurchField";
import { FIELD_INPUT, FIELD_LABEL, FIELD_ROW } from "@/components/ui/formCardClasses";
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
        <>
            <div className={FIELD_ROW}>
                <label htmlFor="church-name" className={FIELD_LABEL}>
                    {t('calendar.church')}
                </label>
                <ChurchField
                    id="church-name"
                    value={church.name ? church : undefined}
                    // Clearing the name keeps the city the person already typed: they are
                    // editing one record, and an empty name is not a reason to lose the city.
                    onChange={(next) => publish({ id: next?.id ?? church.id, name: next?.name ?? "", city: next?.city || church.city || "" })}
                    hideLabel
                    showHistoryCount
                    inputClassName={`${FIELD_INPUT} pr-12`}
                />
            </div>

            <div className={FIELD_ROW}>
                <label htmlFor="church-city" className={FIELD_LABEL}>
                    {t('calendar.city')}
                </label>
                <input
                    id="church-city"
                    type="text"
                    value={church.city || ""}
                    onChange={(e) => publish({ ...church, city: e.target.value })}
                    placeholder={t('calendar.churchAutocomplete.cityPlaceholder')}
                    className={FIELD_INPUT}
                />
            </div>
        </>
    );
}

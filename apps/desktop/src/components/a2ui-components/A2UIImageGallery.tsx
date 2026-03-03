"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UIImageGalleryProps } from "./types";
import { A2UIImage } from "./A2UIImage";

export const A2UIImageGallery = React.memo(function A2UIImageGallery({
    id,
    images,
    isLight = false,
}: A2UIImageGalleryProps) {
    const maxImages = 6;
    const displayImages = (images || []).slice(0, maxImages).filter(img => img.url?.trim());

    if (displayImages.length === 0) return null;

    if (displayImages.length === 1) {
        return (
            <div id={id}>
                <A2UIImage
                    id={`${id}-img-0`}
                    url={displayImages[0].url}
                    caption={displayImages[0].caption}
                    isLight={isLight}
                    aspectRatio="auto"
                />
            </div>
        );
    }

    if (displayImages.length === 2) {
        return (
            <div id={id} className="grid grid-cols-2 gap-2">
                {displayImages.map((img, i) => (
                    <A2UIImage
                        key={`${id}-img-${i}`}
                        id={`${id}-img-${i}`}
                        url={img.url}
                        caption={img.caption}
                        isLight={isLight}
                        aspectRatio="square"
                    />
                ))}
            </div>
        );
    }

    const [hero, ...rest] = displayImages;
    return (
        <div id={id} className="flex flex-col gap-2">
            <A2UIImage
                id={`${id}-img-hero`}
                url={hero.url}
                caption={hero.caption}
                isLight={isLight}
                aspectRatio="video"
            />
            <div className={cn(
                "grid gap-2",
                rest.length <= 2 ? "grid-cols-2" : "grid-cols-3",
            )}>
                {rest.map((img, i) => (
                    <A2UIImage
                        key={`${id}-rest-${i}`}
                        id={`${id}-rest-${i}`}
                        url={img.url}
                        caption={img.caption}
                        isLight={isLight}
                        aspectRatio="square"
                    />
                ))}
            </div>
        </div>
    );
});

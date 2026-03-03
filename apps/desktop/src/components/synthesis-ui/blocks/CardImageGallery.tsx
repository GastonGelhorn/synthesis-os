"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { CardImage } from "./CardImage";

interface GalleryImage {
    url: string;
    caption?: string;
}

interface CardImageGalleryProps {
    images: GalleryImage[];
    isLight?: boolean;
    maxImages?: number;
    className?: string;
}

export const CardImageGallery = React.memo(function CardImageGallery({
    images,
    isLight = false,
    maxImages = 6,
    className,
}: CardImageGalleryProps) {
    const displayImages = images.slice(0, maxImages).filter(img => img.url?.trim());
    if (displayImages.length === 0) return null;

    // Single image: full width
    if (displayImages.length === 1) {
        return (
            <div className={className}>
                <CardImage
                    src={displayImages[0].url}
                    caption={displayImages[0].caption}
                    isLight={isLight}
                    aspectRatio="auto"
                />
            </div>
        );
    }

    // 2 images: side by side
    if (displayImages.length === 2) {
        return (
            <div className={cn("grid grid-cols-2 gap-2", className)}>
                {displayImages.map((img, i) => (
                    <CardImage
                        key={`gallery-${i}`}
                        src={img.url}
                        caption={img.caption}
                        isLight={isLight}
                        aspectRatio="square"
                    />
                ))}
            </div>
        );
    }

    // 3+ images: first one large, rest in a grid
    const [hero, ...rest] = displayImages;
    return (
        <div className={cn("flex flex-col gap-2", className)}>
            <CardImage
                src={hero.url}
                caption={hero.caption}
                isLight={isLight}
                aspectRatio="video"
            />
            <div className={cn(
                "grid gap-2",
                rest.length <= 2 ? "grid-cols-2" : "grid-cols-3",
            )}>
                {rest.map((img, i) => (
                    <CardImage
                        key={`gallery-rest-${i}`}
                        src={img.url}
                        caption={img.caption}
                        isLight={isLight}
                        aspectRatio="square"
                    />
                ))}
            </div>
        </div>
    );
});

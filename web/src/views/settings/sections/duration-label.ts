// "2 H 40", "45 MIN": apart from the stats' page, whose chart library loads only with it.
export const durationLabel = (total: number) => {
  const minutes = Math.round(total)
  return minutes < 60 ? `${minutes} MIN` : `${Math.floor(minutes / 60)} H ${String(minutes % 60).padStart(2, '0')}`
}

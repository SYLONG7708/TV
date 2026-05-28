.class public Lcom/fongmi/android/tv/bean/Config;
.super Ljava/lang/Object;
.source "SourceFile"


# instance fields
.field private home:Ljava/lang/String;
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "home"
    .end annotation
.end field

.field private id:I
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "id"
    .end annotation
.end field

.field private json:Ljava/lang/String;
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "json"
    .end annotation
.end field

.field private logo:Ljava/lang/String;
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "logo"
    .end annotation
.end field

.field private name:Ljava/lang/String;
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "name"
    .end annotation
.end field

.field private notice:Ljava/lang/String;
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "notice"
    .end annotation
.end field

.field private parse:Ljava/lang/String;
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "parse"
    .end annotation
.end field

.field private time:J
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "time"
    .end annotation
.end field

.field private type:I
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "type"
    .end annotation
.end field

.field private url:Ljava/lang/String;
    .annotation runtime Lcom/google/gson/annotations/SerializedName;
        value = "url"
    .end annotation
.end field


# direct methods
.method public constructor <init>()V
    .registers 1

    .line 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    .line 2
    .line 3
    .line 4
    return-void
.end method

.method public static arrayFrom(Ljava/lang/String;)Ljava/util/List;
    .registers 3
    .annotation system Ldalvik/annotation/Signature;
        value = {
            "(",
            "Ljava/lang/String;",
            ")",
            "Ljava/util/List<",
            "Lcom/fongmi/android/tv/bean/Config;",
            ">;"
        }
    .end annotation

    .line 1
    new-instance v0, Lcom/fongmi/android/tv/bean/Config$1;

    .line 2
    .line 3
    invoke-direct {v0}, Lcom/fongmi/android/tv/bean/Config$1;-><init>()V

    .line 4
    .line 5
    .line 6
    invoke-virtual {v0}, Lcom/google/gson/reflect/TypeToken;->getType()Ljava/lang/reflect/Type;

    .line 7
    .line 8
    .line 9
    move-result-object v0

    .line 10
    sget-object v1, Lcom/fongmi/android/tv/App;->t:Lcom/fongmi/android/tv/App;

    .line 11
    .line 12
    iget-object v1, v1, Lcom/fongmi/android/tv/App;->n:Lcom/google/gson/Gson;

    .line 13
    .line 14
    invoke-virtual {v1, p0, v0}, Lcom/google/gson/Gson;->fromJson(Ljava/lang/String;Ljava/lang/reflect/Type;)Ljava/lang/Object;

    .line 15
    .line 16
    .line 17
    move-result-object p0

    .line 18
    check-cast p0, Ljava/util/List;

    .line 19
    .line 20
    if-nez p0, :cond_19

    .line 21
    .line 22
    invoke-static {}, Ljava/util/Collections;->emptyList()Ljava/util/List;

    .line 23
    .line 24
    .line 25
    move-result-object p0

    .line 26
    :cond_19
    return-object p0
.end method

.method public static create(I)Lcom/fongmi/android/tv/bean/Config;
    .registers 2

    .line 1
    new-instance v0, Lcom/fongmi/android/tv/bean/Config;

    invoke-direct {v0}, Lcom/fongmi/android/tv/bean/Config;-><init>()V

    invoke-virtual {v0, p0}, Lcom/fongmi/android/tv/bean/Config;->type(I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    return-object p0
.end method

.method public static create(ILjava/lang/String;)Lcom/fongmi/android/tv/bean/Config;
    .registers 3

    .line 2
    new-instance v0, Lcom/fongmi/android/tv/bean/Config;

    invoke-direct {v0}, Lcom/fongmi/android/tv/bean/Config;-><init>()V

    invoke-virtual {v0, p0}, Lcom/fongmi/android/tv/bean/Config;->type(I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    invoke-virtual {p0, p1}, Lcom/fongmi/android/tv/bean/Config;->url(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->insert()Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    return-object p0
.end method

.method public static create(ILjava/lang/String;Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;
    .registers 4

    .line 3
    new-instance v0, Lcom/fongmi/android/tv/bean/Config;

    invoke-direct {v0}, Lcom/fongmi/android/tv/bean/Config;-><init>()V

    invoke-virtual {v0, p0}, Lcom/fongmi/android/tv/bean/Config;->type(I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    invoke-virtual {p0, p1}, Lcom/fongmi/android/tv/bean/Config;->url(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    invoke-virtual {p0, p2}, Lcom/fongmi/android/tv/bean/Config;->name(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->insert()Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    return-object p0
.end method

.method public static delete(Ljava/lang/String;)V
    .registers 4

    .line 1
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    move-result-object v0

    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 2
    new-instance v1, LM5/j;

    const/4 v2, 0x1

    invoke-direct {v1, p0, v2}, LM5/j;-><init>(Ljava/lang/String;I)V

    iget-object p0, v0, Ly3/g;->f:Lcom/fongmi/android/tv/db/AppDatabase_Impl;

    const/4 v0, 0x0

    invoke-static {p0, v0, v2, v1}, Lcom/bumptech/glide/c;->G(LX1/C;ZZLkotlin/jvm/functions/Function1;)Ljava/lang/Object;

    return-void
.end method

.method public static delete(Ljava/lang/String;I)V
    .registers 5

    .line 3
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    move-result-object v0

    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 4
    new-instance v1, Ly3/c;

    const/4 v2, 0x1

    invoke-direct {v1, p0, p1, v2}, Ly3/c;-><init>(Ljava/lang/String;II)V

    iget-object p0, v0, Ly3/g;->f:Lcom/fongmi/android/tv/db/AppDatabase_Impl;

    const/4 p1, 0x0

    const/4 v0, 0x1

    invoke-static {p0, p1, v0, v1}, Lcom/bumptech/glide/c;->G(LX1/C;ZZLkotlin/jvm/functions/Function1;)Ljava/lang/Object;

    return-void
.end method

.method public static find(I)Lcom/fongmi/android/tv/bean/Config;
    .registers 4

    .line 1
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    move-result-object v0

    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 2
    new-instance v1, Ly3/d;

    const/4 v2, 0x0

    invoke-direct {v1, p0, v2}, Ly3/d;-><init>(II)V

    iget-object p0, v0, Ly3/g;->f:Lcom/fongmi/android/tv/db/AppDatabase_Impl;

    const/4 v0, 0x1

    invoke-static {p0, v0, v2, v1}, Lcom/bumptech/glide/c;->G(LX1/C;ZZLkotlin/jvm/functions/Function1;)Ljava/lang/Object;

    move-result-object p0

    check-cast p0, Lcom/fongmi/android/tv/bean/Config;

    return-object p0
.end method

.method public static find(Lcom/fongmi/android/tv/bean/Config;)Lcom/fongmi/android/tv/bean/Config;
    .registers 2

    .line 7
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getType()I

    move-result v0

    invoke-static {p0, v0}, Lcom/fongmi/android/tv/bean/Config;->find(Lcom/fongmi/android/tv/bean/Config;I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    return-object p0
.end method

.method public static find(Lcom/fongmi/android/tv/bean/Config;I)Lcom/fongmi/android/tv/bean/Config;
    .registers 4

    .line 8
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    move-result-object v0

    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    move-result-object v0

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getUrl()Ljava/lang/String;

    move-result-object v1

    invoke-virtual {v0, v1, p1}, Ly3/g;->e0(Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object v0

    if-nez v0, :cond_1f

    .line 9
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getUrl()Ljava/lang/String;

    move-result-object v0

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getName()Ljava/lang/String;

    move-result-object p0

    invoke-static {p1, v0, p0}, Lcom/fongmi/android/tv/bean/Config;->create(ILjava/lang/String;Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    goto :goto_2b

    :cond_1f
    invoke-virtual {v0, p1}, Lcom/fongmi/android/tv/bean/Config;->type(I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p1

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getName()Ljava/lang/String;

    move-result-object p0

    invoke-virtual {p1, p0}, Lcom/fongmi/android/tv/bean/Config;->name(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    :goto_2b
    return-object p0
.end method

.method public static find(Lcom/fongmi/android/tv/bean/Depot;I)Lcom/fongmi/android/tv/bean/Config;
    .registers 4

    .line 10
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    move-result-object v0

    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    move-result-object v0

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Depot;->getUrl()Ljava/lang/String;

    move-result-object v1

    invoke-virtual {v0, v1, p1}, Ly3/g;->e0(Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object v0

    if-nez v0, :cond_1f

    .line 11
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Depot;->getUrl()Ljava/lang/String;

    move-result-object v0

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Depot;->getName()Ljava/lang/String;

    move-result-object p0

    invoke-static {p1, v0, p0}, Lcom/fongmi/android/tv/bean/Config;->create(ILjava/lang/String;Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    goto :goto_2b

    :cond_1f
    invoke-virtual {v0, p1}, Lcom/fongmi/android/tv/bean/Config;->type(I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p1

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Depot;->getName()Ljava/lang/String;

    move-result-object p0

    invoke-virtual {p1, p0}, Lcom/fongmi/android/tv/bean/Config;->name(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    :goto_2b
    return-object p0
.end method

.method public static find(Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;
    .registers 3

    .line 3
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    move-result-object v0

    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    move-result-object v0

    invoke-virtual {v0, p0, p1}, Ly3/g;->e0(Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object v0

    if-nez v0, :cond_13

    .line 4
    invoke-static {p1, p0}, Lcom/fongmi/android/tv/bean/Config;->create(ILjava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    goto :goto_17

    :cond_13
    invoke-virtual {v0, p1}, Lcom/fongmi/android/tv/bean/Config;->type(I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    :goto_17
    return-object p0
.end method

.method public static find(Ljava/lang/String;Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;
    .registers 4

    .line 5
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    move-result-object v0

    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    move-result-object v0

    invoke-virtual {v0, p0, p2}, Ly3/g;->e0(Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object v0

    if-nez v0, :cond_13

    .line 6
    invoke-static {p2, p0, p1}, Lcom/fongmi/android/tv/bean/Config;->create(ILjava/lang/String;Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    goto :goto_1b

    :cond_13
    invoke-virtual {v0, p2}, Lcom/fongmi/android/tv/bean/Config;->type(I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    invoke-virtual {p0, p1}, Lcom/fongmi/android/tv/bean/Config;->name(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;

    move-result-object p0

    :goto_1b
    return-object p0
.end method

.method public static findUrls()Ljava/util/List;
    .registers 4
    .annotation system Ldalvik/annotation/Signature;
        value = {
            "()",
            "Ljava/util/List<",
            "Lcom/fongmi/android/tv/bean/Config;",
            ">;"
        }
    .end annotation

    .line 1
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    .line 2
    .line 3
    .line 4
    move-result-object v0

    .line 5
    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    .line 6
    .line 7
    .line 8
    move-result-object v0

    .line 9
    invoke-virtual {v0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 10
    .line 11
    .line 12
    new-instance v1, LO5/q;

    .line 13
    .line 14
    const/4 v2, 0x7

    .line 15
    invoke-direct {v1, v2}, LO5/q;-><init>(I)V

    .line 16
    .line 17
    .line 18
    iget-object v0, v0, Ly3/g;->f:Lcom/fongmi/android/tv/db/AppDatabase_Impl;

    .line 19
    .line 20
    const/4 v2, 0x1

    .line 21
    const/4 v3, 0x0

    .line 22
    invoke-static {v0, v2, v3, v1}, Lcom/bumptech/glide/c;->G(LX1/C;ZZLkotlin/jvm/functions/Function1;)Ljava/lang/Object;

    .line 23
    .line 24
    .line 25
    move-result-object v0

    .line 26
    check-cast v0, Ljava/util/List;

    .line 27
    .line 28
    return-object v0
.end method

.method public static getAll(I)Ljava/util/List;
    .registers 4
    .annotation system Ldalvik/annotation/Signature;
        value = {
            "(I)",
            "Ljava/util/List<",
            "Lcom/fongmi/android/tv/bean/Config;",
            ">;"
        }
    .end annotation

    .line 1
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    .line 2
    .line 3
    .line 4
    move-result-object v0

    .line 5
    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    .line 6
    .line 7
    .line 8
    move-result-object v0

    .line 9
    invoke-virtual {v0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 10
    .line 11
    .line 12
    new-instance v1, Ly3/d;

    .line 13
    .line 14
    const/4 v2, 0x1

    .line 15
    invoke-direct {v1, p0, v2}, Ly3/d;-><init>(II)V

    .line 16
    .line 17
    .line 18
    iget-object p0, v0, Ly3/g;->f:Lcom/fongmi/android/tv/db/AppDatabase_Impl;

    .line 19
    .line 20
    const/4 v0, 0x1

    .line 21
    const/4 v2, 0x0

    .line 22
    invoke-static {p0, v0, v2, v1}, Lcom/bumptech/glide/c;->G(LX1/C;ZZLkotlin/jvm/functions/Function1;)Ljava/lang/Object;

    .line 23
    .line 24
    .line 25
    move-result-object p0

    .line 26
    check-cast p0, Ljava/util/List;

    .line 27
    .line 28
    return-object p0
.end method

.method public static live()Lcom/fongmi/android/tv/bean/Config;
    .registers 3

    const-string v0, "https://raw.githubusercontent.com/FGBLH/GHK/refs/heads/main/%E5%AE%89%E5%8D%9A.txt"

    const-string v1, "直播"

    const/4 v2, 0x1

    invoke-static {v0, v1, v2}, Lcom/fongmi/android/tv/bean/Config;->find(Ljava/lang/String;Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object v0

    return-object v0
.end method

.method public static objectFrom(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;
    .registers 3

    .line 1
    sget-object v0, Lcom/fongmi/android/tv/App;->t:Lcom/fongmi/android/tv/App;

    .line 2
    .line 3
    iget-object v0, v0, Lcom/fongmi/android/tv/App;->n:Lcom/google/gson/Gson;

    .line 4
    .line 5
    const-class v1, Lcom/fongmi/android/tv/bean/Config;

    .line 6
    .line 7
    invoke-virtual {v0, p0, v1}, Lcom/google/gson/Gson;->fromJson(Ljava/lang/String;Ljava/lang/Class;)Ljava/lang/Object;

    .line 8
    .line 9
    .line 10
    move-result-object p0

    .line 11
    check-cast p0, Lcom/fongmi/android/tv/bean/Config;

    .line 12
    .line 13
    return-object p0
.end method

.method public static vod()Lcom/fongmi/android/tv/bean/Config;
    .registers 3

    const-string v0, "https://raw.githubusercontent.com/FGBLH/GHK/refs/heads/main/%E6%B5%B7%E8%B1%9A%E5%BD%B1%E8%A7%86.json"

    const-string v1, "點播"

    const/4 v2, 0x0

    invoke-static {v0, v1, v2}, Lcom/fongmi/android/tv/bean/Config;->find(Ljava/lang/String;Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object v0

    return-object v0
.end method

.method public static wall()Lcom/fongmi/android/tv/bean/Config;
    .registers 5

    .line 1
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    .line 2
    .line 3
    .line 4
    move-result-object v0

    .line 5
    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    .line 6
    .line 7
    .line 8
    move-result-object v0

    .line 9
    invoke-virtual {v0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 10
    .line 11
    .line 12
    new-instance v1, Ly3/d;

    .line 13
    .line 14
    const/4 v2, 0x2

    .line 15
    const/4 v3, 0x2

    .line 16
    invoke-direct {v1, v2, v3}, Ly3/d;-><init>(II)V

    .line 17
    .line 18
    .line 19
    iget-object v0, v0, Ly3/g;->f:Lcom/fongmi/android/tv/db/AppDatabase_Impl;

    .line 20
    .line 21
    const/4 v3, 0x1

    .line 22
    const/4 v4, 0x0

    .line 23
    invoke-static {v0, v3, v4, v1}, Lcom/bumptech/glide/c;->G(LX1/C;ZZLkotlin/jvm/functions/Function1;)Ljava/lang/Object;

    .line 24
    .line 25
    .line 26
    move-result-object v0

    .line 27
    check-cast v0, Lcom/fongmi/android/tv/bean/Config;

    .line 28
    .line 29
    if-nez v0, :cond_22

    .line 30
    .line 31
    invoke-static {v2}, Lcom/fongmi/android/tv/bean/Config;->create(I)Lcom/fongmi/android/tv/bean/Config;

    .line 32
    .line 33
    .line 34
    move-result-object v0

    .line 35
    :cond_22
    return-object v0
.end method


# virtual methods
.method public delete()V
    .registers 6

    .line 5
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    move-result-object v0

    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    move-result-object v0

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getUrl()Ljava/lang/String;

    move-result-object v1

    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getType()I

    move-result v2

    invoke-virtual {v0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 6
    new-instance v3, Ly3/c;

    const/4 v4, 0x1

    invoke-direct {v3, v1, v2, v4}, Ly3/c;-><init>(Ljava/lang/String;II)V

    iget-object v0, v0, Ly3/g;->f:Lcom/fongmi/android/tv/db/AppDatabase_Impl;

    const/4 v1, 0x0

    const/4 v2, 0x1

    invoke-static {v0, v1, v2, v3}, Lcom/bumptech/glide/c;->G(LX1/C;ZZLkotlin/jvm/functions/Function1;)Ljava/lang/Object;

    .line 7
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getId()I

    move-result v0

    invoke-static {v0}, Lcom/fongmi/android/tv/bean/History;->delete(I)V

    return-void
.end method

.method public equals(Ljava/lang/Object;)Z
    .registers 5

    .line 1
    const/4 v0, 0x1

    .line 2
    if-ne p0, p1, :cond_4

    .line 3
    .line 4
    return v0

    .line 5
    :cond_4
    instance-of v1, p1, Lcom/fongmi/android/tv/bean/Config;

    .line 6
    .line 7
    const/4 v2, 0x0

    .line 8
    if-nez v1, :cond_a

    .line 9
    .line 10
    return v2

    .line 11
    :cond_a
    check-cast p1, Lcom/fongmi/android/tv/bean/Config;

    .line 12
    .line 13
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getId()I

    .line 14
    .line 15
    .line 16
    move-result v1

    .line 17
    invoke-virtual {p1}, Lcom/fongmi/android/tv/bean/Config;->getId()I

    .line 18
    .line 19
    .line 20
    move-result p1

    .line 21
    if-ne v1, p1, :cond_17

    .line 22
    .line 23
    goto :goto_18

    .line 24
    :cond_17
    move v0, v2

    .line 25
    :goto_18
    return v0
.end method

.method public getDesc()Ljava/lang/String;
    .registers 2

    .line 1
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getName()Ljava/lang/String;

    .line 2
    .line 3
    .line 4
    move-result-object v0

    .line 5
    invoke-static {v0}, Landroid/text/TextUtils;->isEmpty(Ljava/lang/CharSequence;)Z

    .line 6
    .line 7
    .line 8
    move-result v0

    .line 9
    if-nez v0, :cond_f

    .line 10
    .line 11
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getName()Ljava/lang/String;

    .line 12
    .line 13
    .line 14
    move-result-object v0

    .line 15
    return-object v0

    .line 16
    :cond_f
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getUrl()Ljava/lang/String;

    .line 17
    .line 18
    .line 19
    move-result-object v0

    .line 20
    invoke-static {v0}, Landroid/text/TextUtils;->isEmpty(Ljava/lang/CharSequence;)Z

    .line 21
    .line 22
    .line 23
    move-result v0

    .line 24
    if-nez v0, :cond_1e

    .line 25
    .line 26
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getUrl()Ljava/lang/String;

    .line 27
    .line 28
    .line 29
    move-result-object v0

    .line 30
    return-object v0

    .line 31
    :cond_1e
    const-string v0, ""

    .line 32
    .line 33
    return-object v0
.end method

.method public getHome()Ljava/lang/String;
    .registers 2

    .line 1
    iget-object v0, p0, Lcom/fongmi/android/tv/bean/Config;->home:Ljava/lang/String;

    .line 2
    .line 3
    return-object v0
.end method

.method public getId()I
    .registers 2

    .line 1
    iget v0, p0, Lcom/fongmi/android/tv/bean/Config;->id:I

    .line 2
    .line 3
    return v0
.end method

.method public getJson()Ljava/lang/String;
    .registers 2

    .line 1
    iget-object v0, p0, Lcom/fongmi/android/tv/bean/Config;->json:Ljava/lang/String;

    .line 2
    .line 3
    return-object v0
.end method

.method public getLogo()Ljava/lang/String;
    .registers 2

    .line 1
    iget-object v0, p0, Lcom/fongmi/android/tv/bean/Config;->logo:Ljava/lang/String;

    .line 2
    .line 3
    return-object v0
.end method

.method public getName()Ljava/lang/String;
    .registers 2

    .line 1
    iget-object v0, p0, Lcom/fongmi/android/tv/bean/Config;->name:Ljava/lang/String;

    .line 2
    .line 3
    return-object v0
.end method

.method public getNotice()Ljava/lang/String;
    .registers 2

    .line 1
    iget-object v0, p0, Lcom/fongmi/android/tv/bean/Config;->notice:Ljava/lang/String;

    .line 2
    .line 3
    return-object v0
.end method

.method public getParse()Ljava/lang/String;
    .registers 2

    .line 1
    iget-object v0, p0, Lcom/fongmi/android/tv/bean/Config;->parse:Ljava/lang/String;

    .line 2
    .line 3
    return-object v0
.end method

.method public getTime()J
    .registers 3

    .line 1
    iget-wide v0, p0, Lcom/fongmi/android/tv/bean/Config;->time:J

    .line 2
    .line 3
    return-wide v0
.end method

.method public getType()I
    .registers 2

    .line 1
    iget v0, p0, Lcom/fongmi/android/tv/bean/Config;->type:I

    .line 2
    .line 3
    return v0
.end method

.method public getUrl()Ljava/lang/String;
    .registers 2

    .line 1
    iget-object v0, p0, Lcom/fongmi/android/tv/bean/Config;->url:Ljava/lang/String;

    .line 2
    .line 3
    return-object v0
.end method

.method public insert()Lcom/fongmi/android/tv/bean/Config;
    .registers 6

    .line 1
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->isEmpty()Z

    .line 2
    .line 3
    .line 4
    move-result v0

    .line 5
    if-eqz v0, :cond_7

    .line 6
    .line 7
    return-object p0

    .line 8
    :cond_7
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    .line 9
    .line 10
    .line 11
    move-result-object v0

    .line 12
    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    .line 13
    .line 14
    .line 15
    move-result-object v0

    .line 16
    invoke-virtual {v0, p0}, Ly3/g;->z(Ljava/lang/Object;)Ljava/lang/Long;

    .line 17
    .line 18
    .line 19
    move-result-object v0

    .line 20
    invoke-virtual {v0}, Ljava/lang/Long;->longValue()J

    .line 21
    .line 22
    .line 23
    move-result-wide v0

    .line 24
    long-to-int v2, v0

    .line 25
    int-to-long v3, v2

    .line 26
    cmp-long v0, v0, v3

    .line 27
    .line 28
    if-nez v0, :cond_21

    .line 29
    .line 30
    invoke-virtual {p0, v2}, Lcom/fongmi/android/tv/bean/Config;->setId(I)V

    .line 31
    .line 32
    .line 33
    return-object p0

    .line 34
    :cond_21
    new-instance v0, Ljava/lang/ArithmeticException;

    .line 35
    .line 36
    invoke-direct {v0}, Ljava/lang/ArithmeticException;-><init>()V

    .line 37
    .line 38
    .line 39
    throw v0
.end method

.method public isEmpty()Z
    .registers 2

    .line 1
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getUrl()Ljava/lang/String;

    .line 2
    .line 3
    .line 4
    move-result-object v0

    .line 5
    invoke-static {v0}, Landroid/text/TextUtils;->isEmpty(Ljava/lang/CharSequence;)Z

    .line 6
    .line 7
    .line 8
    move-result v0

    .line 9
    return v0
.end method

.method public json(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;
    .registers 2

    .line 1
    invoke-virtual {p0, p1}, Lcom/fongmi/android/tv/bean/Config;->setJson(Ljava/lang/String;)V

    .line 2
    .line 3
    .line 4
    return-object p0
.end method

.method public name(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;
    .registers 2

    .line 1
    invoke-virtual {p0, p1}, Lcom/fongmi/android/tv/bean/Config;->setName(Ljava/lang/String;)V

    .line 2
    .line 3
    .line 4
    return-object p0
.end method

.method public save()Lcom/fongmi/android/tv/bean/Config;
    .registers 5

    .line 1
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->isEmpty()Z

    .line 2
    .line 3
    .line 4
    move-result v0

    .line 5
    if-eqz v0, :cond_7

    .line 6
    .line 7
    return-object p0

    .line 8
    :cond_7
    invoke-static {}, Lcom/fongmi/android/tv/db/AppDatabase;->n()Lcom/fongmi/android/tv/db/AppDatabase;

    .line 9
    .line 10
    .line 11
    move-result-object v0

    .line 12
    invoke-virtual {v0}, Lcom/fongmi/android/tv/db/AppDatabase;->o()Ly3/g;

    .line 13
    .line 14
    .line 15
    move-result-object v0

    .line 16
    invoke-virtual {v0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    .line 17
    .line 18
    .line 19
    new-instance v1, Ly3/b;

    .line 20
    .line 21
    const/4 v2, 0x2

    .line 22
    invoke-direct {v1, v0, p0, v2}, Ly3/b;-><init>(Ly3/g;Lcom/fongmi/android/tv/bean/Config;I)V

    .line 23
    .line 24
    .line 25
    iget-object v0, v0, Ly3/g;->f:Lcom/fongmi/android/tv/db/AppDatabase_Impl;

    .line 26
    .line 27
    const/4 v2, 0x0

    .line 28
    const/4 v3, 0x1

    .line 29
    invoke-static {v0, v2, v3, v1}, Lcom/bumptech/glide/c;->G(LX1/C;ZZLkotlin/jvm/functions/Function1;)Ljava/lang/Object;

    .line 30
    .line 31
    .line 32
    return-object p0
.end method

.method public setHome(Ljava/lang/String;)V
    .registers 2

    .line 1
    iput-object p1, p0, Lcom/fongmi/android/tv/bean/Config;->home:Ljava/lang/String;

    .line 2
    .line 3
    return-void
.end method

.method public setId(I)V
    .registers 2

    .line 1
    iput p1, p0, Lcom/fongmi/android/tv/bean/Config;->id:I

    .line 2
    .line 3
    return-void
.end method

.method public setJson(Ljava/lang/String;)V
    .registers 2

    .line 1
    iput-object p1, p0, Lcom/fongmi/android/tv/bean/Config;->json:Ljava/lang/String;

    .line 2
    .line 3
    return-void
.end method

.method public setLogo(Ljava/lang/String;)V
    .registers 2

    .line 1
    iput-object p1, p0, Lcom/fongmi/android/tv/bean/Config;->logo:Ljava/lang/String;

    .line 2
    .line 3
    return-void
.end method

.method public setName(Ljava/lang/String;)V
    .registers 2

    .line 1
    iput-object p1, p0, Lcom/fongmi/android/tv/bean/Config;->name:Ljava/lang/String;

    .line 2
    .line 3
    return-void
.end method

.method public setNotice(Ljava/lang/String;)V
    .registers 2

    .line 1
    iput-object p1, p0, Lcom/fongmi/android/tv/bean/Config;->notice:Ljava/lang/String;

    .line 2
    .line 3
    return-void
.end method

.method public setParse(Ljava/lang/String;)V
    .registers 2

    .line 1
    iput-object p1, p0, Lcom/fongmi/android/tv/bean/Config;->parse:Ljava/lang/String;

    .line 2
    .line 3
    return-void
.end method

.method public setTime(J)V
    .registers 3

    .line 1
    iput-wide p1, p0, Lcom/fongmi/android/tv/bean/Config;->time:J

    .line 2
    .line 3
    return-void
.end method

.method public setType(I)V
    .registers 2

    .line 1
    iput p1, p0, Lcom/fongmi/android/tv/bean/Config;->type:I

    .line 2
    .line 3
    return-void
.end method

.method public setUrl(Ljava/lang/String;)V
    .registers 2

    .line 1
    iput-object p1, p0, Lcom/fongmi/android/tv/bean/Config;->url:Ljava/lang/String;

    .line 2
    .line 3
    return-void
.end method

.method public toString()Ljava/lang/String;
    .registers 2

    .line 1
    sget-object v0, Lcom/fongmi/android/tv/App;->t:Lcom/fongmi/android/tv/App;

    .line 2
    .line 3
    iget-object v0, v0, Lcom/fongmi/android/tv/App;->n:Lcom/google/gson/Gson;

    .line 4
    .line 5
    invoke-virtual {v0, p0}, Lcom/google/gson/Gson;->toJson(Ljava/lang/Object;)Ljava/lang/String;

    .line 6
    .line 7
    .line 8
    move-result-object v0

    .line 9
    return-object v0
.end method

.method public type(I)Lcom/fongmi/android/tv/bean/Config;
    .registers 2

    .line 1
    invoke-virtual {p0, p1}, Lcom/fongmi/android/tv/bean/Config;->setType(I)V

    .line 2
    .line 3
    .line 4
    return-object p0
.end method

.method public update()Lcom/fongmi/android/tv/bean/Config;
    .registers 3

    .line 1
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->isEmpty()Z

    .line 2
    .line 3
    .line 4
    move-result v0

    .line 5
    if-eqz v0, :cond_7

    .line 6
    .line 7
    return-object p0

    .line 8
    :cond_7
    invoke-static {}, Ljava/lang/System;->currentTimeMillis()J

    .line 9
    .line 10
    .line 11
    move-result-wide v0

    .line 12
    invoke-virtual {p0, v0, v1}, Lcom/fongmi/android/tv/bean/Config;->setTime(J)V

    .line 13
    .line 14
    .line 15
    new-instance v0, Ljava/lang/StringBuilder;

    .line 16
    .line 17
    const-string v1, "config_"

    .line 18
    .line 19
    invoke-direct {v0, v1}, Ljava/lang/StringBuilder;-><init>(Ljava/lang/String;)V

    .line 20
    .line 21
    .line 22
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getType()I

    .line 23
    .line 24
    .line 25
    move-result v1

    .line 26
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    .line 27
    .line 28
    .line 29
    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    .line 30
    .line 31
    .line 32
    move-result-object v0

    .line 33
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->getUrl()Ljava/lang/String;

    .line 34
    .line 35
    .line 36
    move-result-object v1

    .line 37
    invoke-static {v1, v0}, LR6/g;->Q(Ljava/lang/Object;Ljava/lang/String;)V

    .line 38
    .line 39
    .line 40
    invoke-virtual {p0}, Lcom/fongmi/android/tv/bean/Config;->save()Lcom/fongmi/android/tv/bean/Config;

    .line 41
    .line 42
    .line 43
    move-result-object v0

    .line 44
    return-object v0
.end method

.method public url(Ljava/lang/String;)Lcom/fongmi/android/tv/bean/Config;
    .registers 2

    .line 1
    invoke-virtual {p0, p1}, Lcom/fongmi/android/tv/bean/Config;->setUrl(Ljava/lang/String;)V

    .line 2
    .line 3
    .line 4
    return-object p0
.end method
